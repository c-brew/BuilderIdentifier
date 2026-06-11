# AI Builder Evaluator

A multi-agent system that evaluates AI Builder candidates against the KPMG job description — and structurally cannot make the hiring decision. Four isolated agents verify and score blinded evidence; a human reviewer reads the cited scorecard and records the call. Built for the [AI Builder Candidate Assignment](./AI_Builder_Candidate_Assignment_Brief%20copy.pdf).

**Live demo:** _(Vercel URL — pending deploy)_
**Video:** _(link)_
**Scoping doc + AI-use disclosure:** [docs/scoping.md](docs/scoping.md)

## What it does

Upload a resume → one extraction pass creates the candidate → pick the target role (Senior Consultant / Manager, per the brief's two JD appendices) → the pipeline runs:

| Stage | What happens | Who does it |
|---|---|---|
| Blind | Name, contact, education, URLs, and in-text PII stripped | Pure code ([lib/blind.ts](lib/blind.ts)) |
| Verify | HEAD checks, GitHub API fetches, identity-link checks | Plain HTTP ([lib/checks.ts](lib/checks.ts)), then one LLM call each to interpret |
| Assess | Blinded evidence scored 1–5 against the role's JD-anchored rubric, **twice** — divergence between passes is flagged | `claude-opus-4-8`, anonymized input only |
| Synthesize | Reviewer brief with verbatim citations; the output schema has no verdict field | `claude-opus-4-8` |
| Decide | A human records advance/hold/decline with mandatory rationale | You |

Every step lands in an append-only audit log with real token usage, cost in USD, and a SHA-256 of the exact input.

## Governance, structurally

- **Blind scoring** — the scoring agent's input type has no PII fields; the scorecard shows the exact anonymized packet it received ("as the assessor saw it").
- **Recommend-never-decide** — the synthesizer's schema cannot express a verdict; the reviewer decision is one-per-run and immutable (database trigger).
- **Append-only audit** — `UPDATE`/`DELETE` on the audit log are rejected at the database level.
- **Honest verification** — checks are real HTTP; a dead GitHub link is reported as dead, and synthetic candidates' fixture data is tagged `fixture` per fact.
- **Model + cost disclosed** — model ID and per-run cost in the header of every screen.

## Run it locally (~5 minutes)

1. `git clone https://github.com/c-brew/BuilderIdentifier && cd BuilderIdentifier && npm install`
2. Create a [Supabase](https://supabase.com) project → SQL editor → run `create extension if not exists pgcrypto;` then [supabase/schema.sql](supabase/schema.sql)
3. `cp .env.local.example .env.local` and fill in `ANTHROPIC_API_KEY`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`
4. `npm run dev` → http://localhost:3000

Then: upload a resume PDF (or use the seeded candidates), pick a role, hit **Run evaluation** (~1 minute, ~$0.20–0.60 of Anthropic credit), and you'll land on the scorecard.

**What to poke at:** the citation under each score (verbatim from the evidence — challenge it), the "as the assessor saw it" packet (no name anywhere), the audit log (every call, every token, every dollar), and `/rubric` (both role instruments, anchors quoted from the JD). Reset everything with [supabase/reset.sql](supabase/reset.sql).

## Repo tour

```
lib/pipeline.ts      orchestrator — deterministic where possible, LLM only for judgment
lib/agents.ts        the four agents: system prompts + zod output schemas
lib/anthropic.ts     the ONLY path to the Anthropic API — audit + cost capture built in
lib/checks.ts        real HTTP verification (no LLM ever fetches)
lib/blind.ts         Candidate → anonymized packet (pure function)
lib/rubric.ts        per-role rubrics, anchors quoted verbatim from the JD appendices
supabase/schema.sql  governance encoded as constraints (PII quarantine, append-only, immutable decisions)
ARCHITECTURE.md      full architecture + deliberate cuts
DESIGN.md            design system (dark institutional, provenance-coded violet)
docs/scoping.md      framing, tradeoffs, cuts, AI-use disclosure
```

Built with Next.js 15, the Anthropic API (`claude-opus-4-8`), Supabase, and Tailwind 4. See [docs/scoping.md](docs/scoping.md) for how AI was used to build this and which decisions were human.
