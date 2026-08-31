# Aging & Recency Analysis — Current Code State and Suggested Fixes

**Status:** Analysis only — no code changes. Identifies every place the app mishandles
(or cannot represent) the *age* of evidence, and what to fix in each component.

**Date of analysis:** 2026-08-31 · Branch audited: `main` (HEAD `6c1c93f`)

---

## TL;DR

The suspicion is confirmed, and the problem is bigger than one bug. The app has no
real "aging" logic anywhere — recency exists **in a field name only**:

1. `recentCommitCount` (`lib/checks.ts:89`) is a misnomer. It counts the last ≤30
   commits **with no date filter**, so a repository abandoned six years ago still
   reports `recentCommitCount: 30`. The name actively tells the verifier LLM the
   activity is recent when it may not be.
2. The **commit date history is fetched and then thrown away** — only
   `commits[0]` survives — so activity *trends* (sustained iteration vs. a
   one-weekend burst vs. long-dead) can never be computed or judged.
3. The Project Verifier is asked to judge "commit recency" but is **never told
   today's date**, so any recency judgment is made against the model's
   training-era sense of "now" and is unreliable.
4. Age never reaches the blinded Evidence Assessor in structured form — it only
   survives if the verifier happens to phrase it inside a free-text signal string.
5. Candidate evidence, projects, and resume-derived skills have **no date fields
   at all** — in the types, in intake extraction, and in the database schema. A
   2017 case study and a 2025 one are indistinguishable to the scorer and to the
   reviewer. This is the "just unranked skills" symptom: intake lumps the resume's
   Skills/Experience sections into undated evidence blobs, so everything is scored
   purely on content with no time dimension.

Nothing about the *conceptual* design forbids fixing this: dates are not PII, so
carrying them through the blinding boundary is safe, and computing ages
deterministically in `checks.ts` matches the stated architecture stance
("deterministic where possible, LLM only for judgment").

---

## Where "aging" lives today — component by component

### 1. `lib/checks.ts` — the only recency data source, and it's wrong

`fetchRepoFacts()` requests `/commits?per_page=30` and then keeps two things
(`lib/checks.ts:89-90`):

```ts
recentCommitCount: commits?.length,
lastCommitIso: commits?.[0]?.commit?.author?.date,
```

**Findings:**

- **F1 — `recentCommitCount` is not recent.** `commits.length` is just "how many
  of the last 30 commits exist." Any repo with ≥30 lifetime commits scores the
  maximum regardless of when they happened. The field name then propagates that
  false claim into the Project Verifier's input verbatim.
- **F2 — the commit date array is discarded.** The response is typed as
  `{ commit?: { author?: { date?: string } } }[]` — every commit's date is in
  hand — but only index 0 is read. The distribution (first/last date, gap
  lengths, commits in the last 90/365 days) is exactly what "signs of real
  iteration vs tutorial-following" (the verifier's own instruction,
  `lib/agents.ts:46`) needs, and it never survives the function.
- **F3 — author date vs. committer date.** `commit.author.date` is preserved
  across rebases and can be arbitrarily old or wrong; `commit.committer.date`
  reflects when the commit actually landed. For a recency claim, committer date
  is the honest one (or capture both).

**Suggested fix:** compute aging deterministically here, in plain code:

```ts
// proposed RepoFacts additions (names illustrative)
lastCommitIso: string;          // keep, but from committer date
daysSinceLastCommit: number;    // computed against Date.now() at check time
commitsLast90Days: number;      // real recency, date-filtered
commitsLast365Days: number;
firstFetchedCommitIso: string;  // oldest of the 30 — bounds the window honestly
activitySpanDays: number;       // last − first of fetched commits
checkedAtIso: string;           // the "now" the ages were computed against
```

Rename `recentCommitCount` → `fetchedCommitCount` (or drop it) so the name stops
lying. Every value is reproducible and auditable, consistent with the
`verification_checks` row-logging model.

### 2. `lib/agents.ts` — the verifier judges recency blind to "now"

- **F4 — no current-date anchor.** `runProjectVerifier()` passes `ProjectFacts`
  (including `lastCommitIso`) as input, and the system prompt asks for "commit
  recency" as a code-quality signal (`lib/agents.ts:46`) — but nothing in the
  system prompt or input says what today's date is. An LLM cannot reliably
  compute "how old is 2024-03-01" without being told the current date. With the
  §1 fix this mostly disappears (ages arrive pre-computed), but the input should
  still carry `checkedAtIso` so the model can contextualize any raw ISO dates it
  sees.
- **F5 — the assessor's findings type has no age slot.** `BlindedVerifierFindings`
  (`lib/agents.ts:128-136`) forwards only `liveStatus`, free-text
  `codeQualitySignals`, and `concerns` per project. Structured age data has
  nowhere to land. Suggested: add an explicit, deterministic field per project,
  e.g. `activity: { daysSinceLastCommit, commitsLast365Days } | null`, plus one
  sentence in the assessor prompt explaining how to treat it (see §7 on
  governance). Dates are not PII, so this does not weaken the blinding contract.

### 3. `lib/pipeline.ts` — the drop point between verifier and assessor

- **F6 — `blindVerifierFindings()` (`lib/pipeline.ts:318-335`) is where age dies.**
  It maps verifier output to token-keyed findings and keeps only the three fields
  above. Even after fixing `checks.ts`, this function must copy the deterministic
  activity fields from `ProjectFacts` into the blinded findings, or the assessor
  still scores age-blind. Note it should copy from the *deterministic facts*, not
  from the verifier LLM's prose — keep the provenance clean.
- **F7 — index-based join fragility (adjacent bug, same function).** Blinded
  projects are matched to verifier results by array index
  (`project.projects[index]`). The verifier returns `projectTitle` — if the model
  reorders or merges projects, findings (and any new activity data) attach to the
  wrong token silently. Match on title, or instruct/validate order.

### 4. `lib/types.ts`, `lib/intake.ts`, `supabase/schema.sql` — evidence age is unrepresentable

- **F8 — no date fields on candidate material.** `CandidateProject` and
  `CandidateEvidence` (`lib/types.ts:38-50`) have no `period`/`occurredAt`/date
  fields; `candidate_projects` / `candidate_evidence` tables likewise. The same
  type discipline that makes PII "unrepresentable, not just removed" here makes
  *time* unrepresentable — unintentionally.
- **F9 — intake discards every date on the resume.** `candidateFromText()`
  (`lib/intake.ts:50-77`) extracts URLs, emails, names, and section text, but no
  date ranges — even though resumes are the one document where dates are
  reliably present ("2019–2021", "Jan 2024–present"). The Skills section is
  detected as a heading (`lib/intake.ts:160`) and ingested as an undated
  free-text evidence blob. Result: current skills and decade-old skills enter
  the assessor on identical footing — the "only unranked skills" behavior
  observed.
- **F10 — implementation has drifted from ARCHITECTURE.md here.** The
  architecture specifies an LLM `intakeExtractor` (structured output from the
  PDF); the shipped `lib/intake.ts` is regex/heuristic extraction. Whichever
  direction this converges, the extraction schema is the place to add
  `period: { start?: string; end?: string | "present" }` per project/evidence
  item (optional — undated evidence must remain valid, see §7).

**Suggested fix:** add optional period fields to `CandidateProject` /
`CandidateEvidence`, matching nullable columns in `candidate_projects` /
`candidate_evidence` (a `migration-003` following the existing migration
pattern), carry them through `blind.ts` into `BlindedEvidencePacket` (dates are
not PII), and extract them at intake.

### 5. `lib/data.ts` — fixtures can't exercise aging

- **F11 — synthetic candidates have no repo facts at all.** Both fixture blocks
  contain only `urlCheck` entries — no `repo`, so no commit data, so the aging
  path is untested by the fixture candidates and undemonstrable in a demo. Once
  §1's fields exist, `FixtureBlock` fixtures should include at least one repo
  with *old* activity (e.g. `daysSinceLastCommit: 1400`) so the dormant-repo
  path is visible on a synthetic candidate — that's the case that currently
  slips through.

### 6. UI (`app/runs/[id]/page.tsx`, `app/candidates/[id]/page.tsx`) — the reviewer never sees age

- **F12 — verification facts aren't rendered at all.** The run page shows the
  synthesis, scorecard, blinded packet, and audit log — but `verificationChecks`
  (which already carry `lastCommitIso` inside `detail` jsonb) are never displayed.
  The reviewer cannot see that a cited repo is dormant even though the system
  fetched the fact. Suggested: a "Verification facts" section on the run page
  listing each check with, for repos, last-commit age and the recency counts —
  deterministic content, so per the design's provenance rule it renders *without*
  the AI-violet treatment.
- **F13 — candidate page shows no evidence dates** (nothing to show until F8/F9
  land, but the rendering work belongs on the same list).

### 7. `lib/rubric.ts` — the governance decision aging forces

- **F14 — the rubric is silent on evidence age.** "Iterated based on real usage"
  and "continuous improvement" (level-5 descriptors) implicitly reward recency,
  but the instrument gives no rule, so each assessor pass improvises — a
  consistency risk the divergence check will surface as noise.
- **Recommendation — surface age, don't auto-penalize it.** Old evidence is not
  weak evidence: silently downweighting it would disadvantage career-changers
  and returners, the same class of harm blinding exists to prevent. The fix in
  the spirit of this codebase is a second parity-style note alongside
  `EVIDENCE_PARITY_NOTE` (`lib/rubric.ts:138`), e.g.: *"Evidence age must be
  reported, not silently penalized: state when dated evidence is old in the
  rationale and reflect staleness in confidence, not in the score — the human
  reviewer weighs currency."* Then let the deterministic ages (F5) and the UI
  (F12) put the facts in front of the human, where the decision belongs.
- **F15 — synthesizer transparency should disclose the age gap.** Until dates
  exist end-to-end, "evidence dates / currency of skills" belongs in the
  `notChecked` list the candidate sees. Today that disclosure depends on the
  synthesizer LLM volunteering it; the deterministic `TransparencySummary`
  assembly in `pipeline.ts:180-185` could append it as a fixed entry.

---

## Minor/adjacent notes (not aging bugs, spotted during the audit)

- `ARCHITECTURE.md` §4 says `commits?per_page=10`; code fetches 30
  (`lib/checks.ts:57`). Harmless, but the doc and the honest window-bounding in
  F1 should agree.
- `stripSamples()` keeps `lastCommitIso` in `verification_checks.detail`, so
  historical runs already hold last-commit dates — the F12 UI fix can backfill
  display for existing runs without re-running anything.

---

## Suggested fix order

| Priority | Fix | Components | Why this order |
|---|---|---|---|
| 1 | F1–F3: date-filtered commit stats + `checkedAtIso`, rename `recentCommitCount` | `checks.ts`, `types.ts` | Root cause; everything downstream consumes it; pure deterministic code, no prompt or schema risk |
| 2 | F5–F6: carry structured activity into `BlindedVerifierFindings`; F4 now-anchor in verifier input | `pipeline.ts`, `agents.ts` | Gets age to the only agent that scores |
| 3 | F14: rubric aging note (report, don't penalize) | `rubric.ts` | Must land with #2 or passes will diverge on how to treat the new data |
| 4 | F12: render verification facts (incl. repo age) on the run page | `app/runs/[id]/page.tsx` | Puts the fact in front of the human; works for old runs too |
| 5 | F8–F10: evidence/project period fields — types, intake extraction, DB migration, blinding pass-through | `types.ts`, `intake.ts`, `blind.ts`, `supabase/` | Biggest change surface; fixes the "undated skills" half |
| 6 | F11, F13, F15, F7: fixtures with dormant repos, candidate-page dates, transparency line, title-based join | `data.ts`, UI, `pipeline.ts` | Hardening + demo visibility |

Items 1–4 are contained (no schema migration, no intake changes) and would fix
the reported bug — "old trends not considered" — end to end for repo evidence.
Item 5 is what makes *non-code* evidence age-aware, which the equal-footing rule
says should not lag behind code evidence.
