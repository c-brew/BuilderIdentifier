# AI Builder Evaluator — Architecture

**Status:** Architecture locked. Visual design locked in `DESIGN.md`. Implementation follows.
**Constraint that shapes everything:** 3-hour total timebox (build + scoping doc + video). Every decision below optimizes for *demoable, defensible, and inspectable* over complete.

---

## 1. Framing

A multi-agent system that evaluates AI Builder candidates against the KPMG JD and produces a **reasoning trace for a human reviewer** — never a verdict. The system's own design is the argument: workflow thinking, decision boundaries, governance as a structural constraint rather than a disclaimer.

Core architectural stance:

1. **Deterministic where possible, LLM only for judgment.** URL liveness, blinding, cost accounting, and audit logging are plain code. LLMs assess quality, interpret evidence, and synthesize. This is cheaper, faster, more auditable — and it's the human-AI decision-boundary thinking the JD asks for.
2. **Isolation by construction, not by convention.** Agents can't share state because each agent is a single stateless API call with its own system prompt. There is no shared conversation to leak through.
3. **Blinding is type-enforced.** The Evidence Assessor's input type literally has no fields for name/photo/school. The redaction is a pure function with a unit-testable contract, not a prompt instruction ("please ignore the name") that a model could violate.
4. **Recommend-never-decide is a UI affordance.** The reviewer records their own decision and rationale; the system's output is evidence + confidence, displayed as inputs to that decision.

---

## 2. Stack

| Layer | Choice | Why |
|---|---|---|
| Framework | Next.js 15+ (App Router, TypeScript) | Net-new per spec; route handlers do orchestration; Vercel-native |
| LLM | Anthropic API via `@anthropic-ai/sdk` | Per spec |
| Model | `claude-opus-4-8` (single constant, see §6) | Most capable; one model for all agents keeps disclosure simple |
| Ingestion | Resume upload (PDF) → one extraction LLM call → candidate record | The Anthropic API reads PDFs natively; structured outputs return a `Candidate` directly. Synthetic candidates remain JSON seeds (they need fixtures) |
| Persistence | Supabase (Postgres) via `@supabase/supabase-js` | Normalized schema (`supabase/schema.sql`, §12) that encodes the governance model in constraints — PII quarantine, append-only audit, immutable decisions. Server-side access only (service role key in Vercel env) |
| Streaming | NDJSON over a streamed `Response` from the orchestration route | Live agent-progress UI for the demo |
| Deploy | Vercel | Per spec |
| Styling | Tailwind, dark institutional theme | Design phase — out of scope here |

No queue, no auth, no retries beyond the SDK's built-in backoff, no external services beyond Anthropic + public HTTP/GitHub.

---

## 3. Repo layout

```
/
├─ app/
│  ├─ page.tsx                    # Candidate roster (queue list, not grid — per DESIGN.md)
│  ├─ candidates/[id]/page.tsx    # Candidate detail + "Run evaluation"
│  ├─ runs/[id]/page.tsx          # Live run view → scorecard (fetches run from /api/runs/[id])
│  ├─ rubric/page.tsx             # Renders rubric.ts verbatim — same instrument for everyone
│  └─ api/
│     ├─ candidates/route.ts      # POST — resume upload → intake extraction → candidate persisted
│     ├─ evaluate/route.ts        # POST — runs the pipeline (streams NDJSON), persists run to Supabase on completion
│     └─ runs/
│        ├─ route.ts              # GET ?candidateId= — list runs
│        └─ [id]/route.ts         # GET — fetch run · PATCH — save ReviewerDecision + reviewer_action audit entries
├─ components/
│  ├─ AIRequestPanel.tsx          # Centerpiece: AI brief + human decision capture (§9a)
│  ├─ AgentCard.tsx, ScoreBlock.tsx, AuditTable.tsx, Badge.tsx,
│  │  ConfidenceChip.tsx, GovernanceBanner.tsx, StatusDot.tsx
│  └─ ...                         # ~10 bespoke Tailwind components, no component library (DESIGN.md §6)
├─ lib/
│  ├─ agents/
│  │  ├─ intakeExtractor.ts       # Agent 0 — resume PDF → Candidate (structured output, audited)
│  │  ├─ projectVerifier.ts       # Agent 1
│  │  ├─ evidenceAssessor.ts      # Agent 2
│  │  ├─ identityVerifier.ts      # Agent 3
│  │  └─ synthesizer.ts           # Agent 4
│  ├─ pipeline.ts                 # Orchestrator: stage sequencing, parallelism, consistency check
│  ├─ blind.ts                    # redactCandidate(): Candidate → BlindedEvidencePacket (pure fn)
│  ├─ checks.ts                   # Deterministic: HEAD requests, GitHub API fetch (no LLM)
│  ├─ anthropic.ts                # Client singleton, callAgent() wrapper (audit + cost capture)
│  ├─ db.ts                       # Supabase server client: saveRun / getRun / listRuns / patchDecision
│  ├─ cost.ts                     # Pricing constants, usage → USD
│  ├─ rubric.ts                   # JD-mapped rubric (data, not prose)
│  └─ types.ts                    # All shared types — the contracts in §5
├─ supabase/
│  └─ schema.sql                  # Full DDL — governance encoded as constraints (§12)
├─ scripts/
│  └─ seed.ts                     # Upserts data/candidates/*.json into the candidate tables
├─ data/
│  ├─ candidates/
│  │  ├─ connor-brewer.json       # Real — live checks run
│  │  ├─ synth-engineer.json      # Synthetic — fixture mode
│  │  ├─ synth-designer.json      # Synthetic, non-code evidence path
│  │  └─ synth-weak.json          # Synthetic, deliberately thin evidence (shows discrimination)
│  └─ jd.json                     # Distilled JD source material
├─ docs/
│  └─ scoping.md                  # 1-page scoping doc (deliverable)
└─ ARCHITECTURE.md                # This file
```

---

## 4. Pipeline (the orchestrator)

**Intake (once per candidate, before any run):** `POST /api/candidates` with a resume PDF. One LLM call (`intakeExtractor`) receives the PDF as a native document block and returns a `Candidate` via structured output — name/email/education into `candidate_pii`, links/projects/evidence into their tables. The extraction is audited like any agent call (model, tokens, cost, input digest of the PDF). The candidate then appears on the roster; no hand-authored JSON for real candidates. The reviewer can eyeball the extracted record before running an evaluation — extraction errors are correctable at the source, not discovered mid-pipeline.

**Evaluation:** `POST /api/evaluate` with `{ candidateId }`. Single route handler, `export const maxDuration = 300` (needs Vercel Fluid Compute, on by default). Streams NDJSON progress events so the UI shows agents working live.

```
load candidate JSON
        │
        ▼
┌──────────────────────────────┐
│ Stage 0 — Blind (pure code)  │  redactCandidate() → BlindedEvidencePacket
└──────────────────────────────┘  audit entry: which fields were stripped
        │
        ▼  (parallel — Promise.all)
┌───────────────────┐  ┌───────────────────┐
│ Stage 1a           │  │ Stage 1b          │
│ Project Verifier   │  │ Identity Verifier │
│ checks.ts (deter-  │  │ checks.ts + 1 LLM │
│ ministic) + 1 LLM  │  │ call              │
│ call               │  │                   │
└───────────────────┘  └───────────────────┘
        │                       │
        ▼                       │
┌──────────────────────────────┐│
│ Stage 2 — Evidence Assessor  ││  Input: BlindedEvidencePacket ONLY
│ run TWICE (consistency)      ││  + verifier facts (also blinded)
└──────────────────────────────┘│
        │                       │
        ▼                       ▼
┌──────────────────────────────────────────┐
│ Stage 3 — Synthesizer                    │  Compiles scorecard, citations,
│ (receives all agent outputs + divergence)│  confidence, flags divergence
└──────────────────────────────────────────┘
        │
        ▼
EvaluationRun { scorecard, agentOutputs, auditLog, transparencySummary }
→ persisted to Supabase → final NDJSON event to client
```

**Stream events:** `{type: "stage_start" | "stage_complete" | "audit", ...}` then a terminal `{type: "run_complete", run: EvaluationRun}`. If a stage throws, emit `{type: "run_error"}` with partial audit log — failures are auditable too.

### Stage details

**Stage 1a — Project Verifier.** Two phases:
- *Deterministic (`checks.ts`):* `fetch(url, {method: "HEAD"})` with timeout per listed project URL → `{url, status, live: boolean, latencyMs}`. For GitHub repos: unauthenticated GitHub REST (`/repos/{owner}/{repo}`, `/contents`, `/commits?per_page=10`) → file tree, README presence, language breakdown, commit recency, plus 2–3 representative source files (capped bytes).
- *LLM (1 call):* receives the fetched facts + code samples, returns code-quality signals (structure, tests present, README quality, signs of real iteration vs. tutorial-clone) as structured output. The LLM never fetches anything itself — no tool use, no SSRF surface, fully reproducible inputs in the audit log.

**Stage 1b — Identity Verifier.** Deterministic checks: each social/profile URL resolves (HEAD/GET status), domain matches the claimed platform, handle in URL matches handle claimed in the candidate file. One LLM call to cross-reference consistency (do the claimed links plausibly belong to one person — same handle/name patterns) and output `verified | unverified | mismatch` per link **with no content scoring whatsoever** — the system prompt scopes it to verification only.

**Stage 2 — Evidence Assessor.** Input is exclusively the `BlindedEvidencePacket` plus blinded verifier facts (liveness booleans and code-quality signals, with identifying URLs replaced by `evidence-1`, `evidence-2` tokens). Scores against the JD-mapped rubric (§7): four dimensions, 1–5, each requiring a cited quote from the evidence and a stated confidence. Explicit instruction set: non-code evidence (demos, writeups, case studies) scores on equal footing — the rubric dimensions are about thinking and ownership, not language fluency in code.

**Consistency check:** the Assessor — the only subjective scorer — runs twice with identical input. The pipeline diffs per-dimension scores; any dimension differing by >1 point (on the 5-point scale) is flagged `divergent: true` and both scores are shown to the reviewer. The verifiers are deterministic-input/factual-output, so re-running the whole pipeline would double cost for no signal — this is the cheapest honest consistency check.

**Stage 3 — Synthesizer.** One LLM call receiving all structured outputs. Its output schema is `SynthesizerBrief` (§5) — deliberately shaped as the *content of the AI Request panel* (DESIGN.md §4): a 3–5 sentence brief with inline citations, the verified / not-checked lists, overall confidence with stated reasons, and divergence count. The system prompt forbids hire/no-hire language; the output schema has no recommendation field to put it in. The panel renders these fields directly — no client-side parsing or re-summarizing of LLM prose.

### Synthetic candidates: fixture mode

Synthetic candidates carry `"mode": "synthetic"` and a `fixtures` block containing canned `checks.ts` results (fake URLs are never fetched). The pipeline substitutes fixtures for live checks and every audit entry for those stages is tagged `source: "fixture"`. The UI badges synthetic candidates. Connor's file is `"mode": "live"` — real header checks, real GitHub fetches, on camera.

---

## 5. Data contracts (`lib/types.ts`)

These types are the architecture. Sketches, not exhaustive:

```ts
type Candidate = {
  id: string;
  mode: "live" | "synthetic";
  // PII — exists ONLY here, stripped by blind.ts
  pii: { name: string; education: string[]; email?: string };
  links: { kind: "github" | "linkedin" | "portfolio" | "other"; url: string; claimedHandle: string }[];
  projects: { title: string; url?: string; repoUrl?: string; description: string }[];
  evidence: { kind: "code" | "demo" | "writeup" | "case-study"; title: string; body: string; url?: string }[];
  fixtures?: FixtureBlock; // synthetic only
};

// NOTE: no pii field, no names, no school — unrepresentable, not just removed.
// URLs replaced with opaque tokens (evidence-1, …); the tokenMap lives on
// EvaluationRun (never in any LLM input) and powers the reviewer's de-blind toggle.
type BlindedEvidencePacket = {
  candidateToken: string;            // e.g. "CAND-3F2A" — random per run
  projects: { token: string; description: string }[];
  evidence: { token: string; kind: string; title: string; body: string }[];
};

type AgentOutput<T> = {
  agent: "projectVerifier" | "evidenceAssessor" | "identityVerifier" | "synthesizer";
  result: T;                         // schema-validated structured output
  confidence: "high" | "medium" | "low";
};

type RubricScore = {
  dimension: "workflow-thinking" | "end-to-end-ownership" | "ambiguity" | "responsible-ai";
  score: 1 | 2 | 3 | 4 | 5;
  citation: string;                  // verbatim quote from blinded evidence
  rationale: string;
  confidence: "high" | "medium" | "low";
};

type AuditEntry = {
  ts: string;
  stage: string;
  kind: "llm_call" | "http_check" | "blinding" | "fixture" | "intake" | "reviewer_action";
                                     // reviewer_action: appended CLIENT-side post-run
                                     // (de-blind toggle used, decision recorded) — see §9a
  model?: string;                    // exact model ID for llm_call
  usage?: { inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheWriteTokens: number };
  costUsd?: number;
  durationMs: number;
  inputDigest: string;               // sha256 of the exact input — reproducibility claim
  summary: string;                   // human-readable one-liner
};

// Synthesizer output is shaped FOR the AI Request panel (DESIGN.md §4) —
// the panel's sections map 1:1 onto these fields, no client-side parsing.
type SynthesizerBrief = {
  brief: string;                     // 3–5 sentences: strongest evidence (inline citations),
                                     // weakest area, overall confidence + why. No verdict field exists.
  verified: string[];                // "WHAT WAS VERIFIED" list (factual, from verifier outputs)
  notChecked: string[];              // "WHAT WAS NOT CHECKED" list (feeds transparency too)
  overallConfidence: "high" | "medium" | "low";
  divergenceCount: number;
};

// The human side of the AI Request panel. Created client-side, never by an LLM.
type ReviewerDecision = {
  runId: string;
  ts: string;
  decision: "advance" | "hold" | "decline";
  rationale: string;                 // required, min 1 sentence — UI blocks recording without it
};

type EvaluationRun = {
  id: string;
  candidateId: string;
  startedAt: string;
  model: string;                     // disclosed in UI
  scorecard: { scores: RubricScore[]; divergence: DivergenceFlag[]; synthesis: SynthesizerBrief };
  agentOutputs: AgentOutput<unknown>[];
  blindedPacket: BlindedEvidencePacket; // for "view as the Assessor saw it" (DESIGN.md §5)
  tokenMap: Record<string, string>;  // token → identity, used to annotate the
                                     // "as the Assessor saw it" view. Never enters any LLM input.
  auditLog: AuditEntry[];
  totalCostUsd: number;
  transparency: TransparencySummary; // what was checked / not checked / how to contest
  reviewerDecision?: ReviewerDecision; // saved via PATCH /api/runs/[id] after the run completes
};
```

**Structured outputs everywhere.** Every LLM call uses `output_config.format` with a JSON schema (the SDK's `messages.parse()` + zod via `zodOutputFormat`). No JSON-from-prose parsing, no malformed-output retries to write — guaranteed-parseable agent outputs is what makes a 3-hour multi-agent build feasible.

---

## 6. Anthropic API usage (`lib/anthropic.ts`, `lib/cost.ts`)

- **One wrapper:** `callAgent({agentName, system, input, schema})` — constructs the call, validates output against the zod schema, computes cost from `response.usage`, appends the `AuditEntry`, returns typed result. Every agent goes through it; nothing can call the API and dodge the audit log.
- **Model:** single constant `MODEL_ID = "claude-opus-4-8"` exported from one place, rendered in the UI header and stamped on every run/audit entry. One model for all four agents — per-agent model mixing is a deliberate cut (it complicates the disclosure story and the consistency claim for marginal savings on a demo that runs a handful of evaluations).
- **Pricing constants** (claude-opus-4-8): input $5.00/MTok, output $25.00/MTok, cache read $0.50/MTok, cache write $6.25/MTok. `costUsd = f(usage)`; run total is the sum over audit entries. Stamp the pricing table version in the run for honesty if rates change.
- **Thinking:** `thinking: {type: "adaptive"}` on the Assessor and Synthesizer (judgment-heavy); omit for the two verifier calls (interpretation of already-fetched facts; effort `medium` there if needed).
- **Prompt caching:** one `cache_control` breakpoint on the shared JD + rubric block in the Assessor's system prompt — the consistency re-run hits the cache, halving the most expensive duplicated input. Anything fancier is not worth the timebox.
- **Streaming from Anthropic:** not needed (structured outputs, modest sizes, `max_tokens` ≤ 8K per call). The *route* streams progress events; the individual API calls are simple awaited requests.

Estimated cost per full evaluation: 5 LLM calls (verifier ×2, assessor ×2, synthesizer ×1), roughly 30–60K total input + 8–15K output tokens → **~$0.40–$0.90 per run** at Opus 4.8 rates. Displayed live in the UI; this is the cost-per-evaluation disclosure.

---

## 7. Rubric (`lib/rubric.ts`)

Data, not prose — each dimension carries its JD anchor so citations trace back to source material:

| Dimension | JD anchor (Appendix A) |
|---|---|
| `workflow-thinking` | "think in workflows, not just models … human-AI handoffs, decision boundaries, appropriate levels of autonomy" |
| `end-to-end-ownership` | "from problem definition through to a working system that people actually use" |
| `ambiguity` | "comfortable operating in ambiguity … enterprise transformation is rarely linear" |
| `responsible-ai` | "risk, governance, ethics, and trust as core design constraints rather than afterthoughts" |

Each dimension defines: the anchor quote, level descriptors for 1/3/5, and an explicit note that evidence kind (code vs. demo vs. writeup) must not affect scoring. The rubric is rendered in the UI so candidates and reviewers see the same instrument.

---

## 8. Governance — requirement → mechanism map

| Requirement | Where it lives | Mechanism |
|---|---|---|
| Blind scoring | `lib/blind.ts` + `BlindedEvidencePacket` type | Pure function; PII fields unrepresentable in assessor input; unit-tested |
| Model + version disclosed | `MODEL_ID` constant → UI header + every run record | Single source of truth |
| Full audit log + cost | `callAgent()` wrapper + `AuditEntry[]` | Unbypassable: only path to the API; includes input digests, tokens, USD |
| Recommend-never-decide | `SynthesizerBrief` schema (no verdict field) + AI Request panel (§9a) | Structurally impossible to emit a verdict; `ReviewerDecision` is client-only — no API route exists for the system to receive it |
| Blinding is provable, not just claimed | `blindedPacket` + `tokenMap` on the run (§9a) | "As the Assessor saw it" view shows the exact anonymized input the scorer received |
| Candidate transparency | `TransparencySummary` generated per run | Checked / not-checked / contest-path rendered as its own tab |
| Consistency check | Pipeline runs Assessor ×2, diffs scores | Divergence >1 point flagged on the scorecard, both scores shown |
| Verification ≠ judgment | Identity Verifier scope | System prompt + output schema permit only link-validity findings |

---

## 9. UI surface

Visual language, tokens, components, and screen layouts are specified in `DESIGN.md` — this section covers only what the design adds to the *architecture*.

Three screens (roster queue / live run view with right rail / tabbed scorecard), governance banner on every screen, ~10 bespoke Tailwind components in `components/`, no component library.

**Provenance is a data concern, not just a color.** DESIGN.md reserves the `ai` violet for LLM-authored content; that rule is enforceable because the type system already separates sources — anything inside an `AgentOutput` or `SynthesizerBrief` is AI-authored, anything from `checks.ts`/`blind.ts` is deterministic. Components never receive ambiguous strings: `ScoreBlock` knows its citation is LLM-selected (violet-bordered blockquote), `AuditTable` knows its rows are facts (no violet). No `isAi` flags threaded through props — provenance falls out of which type a component renders.

The run view's right rail (elapsed time, live cost, last-5 audit feed) consumes the same NDJSON `audit` events as the agent cards — no extra plumbing.

### 9a. The AI Request panel (design centerpiece → architectural contract)

DESIGN.md §4 defines the panel where the system **briefs the reviewer and formally requests a human decision**. Architecturally it adds three things:

1. **A shaped Synthesizer contract.** `SynthesizerBrief` (§5) exists so the panel's sections — "what the system found", verified / not-checked columns, confidence, divergence — bind 1:1 to schema fields. The design's seam between AI territory (violet) and human territory (plain border) is mirrored in the data: everything above the seam comes from `SynthesizerBrief`, everything below is `ReviewerDecision`.
2. **A write path the pipeline can't read.** `ReviewerDecision` is created in the browser, validated (rationale required), saved via `PATCH /api/runs/[id]`, and rendered back read-only. It's stored in Supabase for the record, but no pipeline code reads it and it never enters any LLM call — "recommend-never-decide" holds because the decision is downstream-only data.
3. **Appendable audit log.** Decision recording appends an `AuditEntry { kind: "reviewer_action" }` via the same PATCH. The pipeline-produced log is immutable history; reviewer actions are appended after it, timestamped and attributed.

**Blinding scope — model-facing only.** The spec strips identity *before assessment*; assessment means the LLM, not the human. The reviewer sees the candidate's name throughout (roster, scorecard header) — `GET /api/runs/[id]` joins the run with the candidate in one query, since `evaluation_runs.candidate_id` always carries the linkage. The governance proof is the "view packet as the Assessor saw it" tab: it shows the anonymized input (annotated via `tokenMap`), demonstrating the scorer could not have known whom it was scoring.

---

## 10. Deliberate cuts (feeds the scoping doc)

| Cut | Why it's the right cut |
|---|---|
| ORM / migration tooling / RLS on Supabase | One hand-written `schema.sql` applied once; service-role key server-side only, single trust boundary. RLS + auth is the stated first addition for multi-reviewer use |
| Auth | Single-reviewer demo; would be first addition for real use |
| LLM tool use / agentic fetching | Deterministic fetch + single interpretation call is cheaper, safer (no SSRF), and fully reproducible |
| Per-agent model mixing | Complicates disclosure and consistency claims for cents of savings |
| Full-pipeline consistency run | Verifiers are deterministic; doubling them is cost without signal |
| Retry/queue infrastructure | SDK retries 429/5xx; a failed run streams its partial audit log and is re-runnable |
| Resume-format edge cases (DOCX, scans, multi-file) | One PDF in, one extraction call — the API reads PDFs natively. Format breadth is commodity work; the demo needs exactly one real resume |
| Bias evaluation beyond blinding | Real fairness work needs population-scale testing; claiming it from n=4 would be the *irresponsible* AI move — say so in the doc |

---

## 11. Build order (the ~2h coding budget)

0. **Prereqs (not coding time):** Supabase project created, `schema.sql` applied, storage bucket for resumes, env vars set locally + in Vercel, Connor's resume PDF on hand.
1. **Contracts first** (~15m): `types.ts`, `rubric.ts`, seed JSON for 1 synthetic candidate. Everything else codes against these.
2. **Spine** (~45m): `anthropic.ts` wrapper + `cost.ts`, `db.ts`, `blind.ts`, `checks.ts`, `pipeline.ts` with the Assessor only — one-agent end-to-end run proving stream → audit → Supabase row → scorecard fetch.
3. **Remaining agents** (~30m): intake extractor + upload route, verifiers (parallel stage), synthesizer, consistency diff. Each is a system prompt + schema slotted into the existing wrapper.
4. **UI** (~30m): tokens into Tailwind config, roster (with resume upload), run view consuming the stream, tabbed scorecard with the **AI Request panel** (centerpiece of both the design and the video — build it before the other tabs).
5. **Polish only if time**: second synthetic candidate, transparency tab niceties, `scripts/seed.ts` (until then, insert the synthetic candidate by hand in the SQL editor).

If time runs short, cut from the bottom of each step — and know the floor: the demo survives with one synthetic candidate and a plain audit table; it does not survive without the blinding + audit spine, intake, or the AI Request panel. If step 2 overruns badly, the escape hatch is demoting intake to "pre-extracted candidate row" and uploading the resume off-camera.

---

## 12. Env & config

```
ANTHROPIC_API_KEY=           # server-only — never NEXT_PUBLIC
SUPABASE_URL=                # server-only; all DB access goes through route handlers
SUPABASE_SERVICE_ROLE_KEY=   # server-only — the browser never talks to Supabase directly
```

### Database schema (`supabase/schema.sql`)

Full normalized schema — run once in the Supabase SQL editor. The point of going relational instead of a jsonb blob: **the governance model is enforced by the database**, not just by application code.

| Table | Holds | Governance property encoded |
|---|---|---|
| `users` | Reviewers (seeded, no auth flow) | Decisions and de-blinds are attributable to a person |
| `candidates` | Candidate identity-free core | Deliberately PII-free — everything joinable to evaluation data |
| `candidate_pii` | Name, photo, education (1:1) | **PII quarantine**: only the de-blind endpoint and roster read it; no pipeline/scoring query joins it |
| `candidate_links` / `candidate_projects` / `candidate_evidence` | Source material | Typed evidence kinds — non-code paths are first-class |
| `evaluation_runs` | One row per pipeline execution | Model ID + pricing version stamped per run; jsonb only for document-shaped artifacts (blinded packet, token map, synthesis, transparency) |
| `verification_checks` | Each deterministic fact (HEAD check, GitHub fetch, identity link) | `source: live\|fixture` per fact — fixture substitution auditable at row level |
| `agent_outputs` | Full structured LLM output per (run, agent, pass) | `unique(run_id, agent, pass)` — the consistency check's two passes are schema-level |
| `scores` | One row per (run, dimension, pass) | `citation` and `confidence` are NOT NULL — an uncited score is unrepresentable; score `CHECK between 1 and 5` |
| `score_divergence` (view) | Derived pass-1 vs pass-2 delta | Divergence computed, never stored — single source of truth |
| `audit_log` | Every LLM call (tokens/cost), HTTP check, blinding, fixture, reviewer action | **Append-only via trigger** — history cannot be edited; `actor_user_id` NULL = system, set = human |
| `reviewer_decisions` | The human call | PK = `run_id` (exactly one per run), rationale `CHECK length ≥ 20`, **immutable via trigger** — changing your mind means a new run, not an edited record; no pipeline table references it |

Write path stays simple: the pipeline builds `EvaluationRun` in memory exactly as before; `db.ts saveRun()` inserts the run row at stage 0 (`status: running`) and fans out child-table inserts on completion (or stamps `status: error` with the partial audit log). RLS intentionally off — service-role key, single trust boundary, documented as a cut.

`vercel.json` / route config: `maxDuration = 300` on `/api/evaluate`. No other infrastructure.
