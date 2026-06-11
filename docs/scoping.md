# Scoping — AI Builder Evaluator

## How I framed the problem

"Build something that evaluates an AI Builder well" is a trap if you read it as "build a scoring tool." A scoring tool's failure mode is the exact thing the JD warns against: treating governance as an afterthought. So I reframed: **the evaluator itself should demonstrate the role's competencies** — workflow thinking, decision boundaries, responsible AI as a design constraint — and the test of that is whether the governance is *structural* rather than promised. The system verifies and assesses; it is built to be incapable of deciding.

The topic is the vehicle; the build is the argument.

## What I optimized for

1. **Governance you can inspect, not believe.** Blinding is a pure function into a type with no PII fields; the verdict is unrepresentable in the synthesizer's schema; the audit log rejects edits at the database level. A reviewer can challenge any score because every score carries a verbatim citation.
2. **The right human-AI boundary.** Deterministic code does everything deterministic (HTTP checks, redaction, cost math). LLMs only interpret and judge. The human makes the only decision that matters — and must write down why.
3. **Honesty over polish.** Real checks report dead links as dead. Synthetic candidates' fixture data is labeled per fact. The consistency check (same evidence scored twice, divergence flagged) measures the system's own reliability and shows the reviewer both numbers.

## Deliberate cuts (and why they're the right cuts)

- **No auth / RLS** — single-reviewer demo, single trust boundary; first addition for real use.
- **Heuristic resume extraction** (regex, not LLM) — deterministic and cheap; extraction quality is commodity work that proves nothing about the argument. Would be the first quality upgrade.
- **No bias evaluation beyond blinding** — real fairness work needs population-scale testing; claiming it from n=4 candidates would itself be irresponsible AI. Said plainly instead.
- **Consistency check on the assessor only** — the verifiers are deterministic-input/factual-output; re-running them doubles cost for no signal.
- **One model for all agents** — per-agent model mixing saves cents and muddies the disclosure story ("model + version disclosed" should be one line, not a matrix).
- **Resume format breadth** — one PDF in, one candidate out. DOCX/scans/multi-file are integration work.

## What I'd do with more time

LLM-based intake extraction (the current regex parser produces rough project titles); an evaluation harness for the assessor itself — a calibration set of known packets to measure score stability and citation faithfulness across model versions; multi-reviewer flow with RLS and decision reconciliation; a candidate-facing portal serving the transparency summary ("what was checked, what wasn't, how to contest") directly to the person being evaluated.

## AI-use disclosure

This project was built with Claude Code (Anthropic's CLI agent, model: Claude Fable 5). The product itself calls `claude-opus-4-8` via the Anthropic API. Specifics, because the brief asks for them:

**Decisions that were mine (Connor):**
- The framing above — evaluator-as-argument, recommend-never-decide, blind scoring as a structural property.
- Architecture direction at every fork: Supabase for persistence (my standard stack), normalized schema with governance constraints as a differentiator, resume upload as the front door, anchoring the rubric to both JD appendices with reviewer-selected target role, and the call that blinding is **model-facing only** (the hiring manager must see who scored what — hiding it from the human adds friction without governance payoff).
- All scope cuts listed above, and the design system in DESIGN.md (provenance-coded violet for AI-authored content, verdict-free visual grammar).

**What AI did:**
- Wrote most of the code, the schema DDL, and the agent system prompts against my architecture and design docs; drafted ARCHITECTURE.md sections for my review and correction.
- Debugged (a `pdf-parse` bundling crash, a CSS cascade-layer bug that suppressed the provenance color) and fixed post-run UX gaps I found in testing.

**A disclosure-relevant moment:** mid-build, a working session produced a pipeline with *simulated* LLM calls — keyword-matching scores and fabricated token counts in the audit log. Reviewing the code caught it, and it was replaced with real API calls before anything shipped. I'm including this because it's the strongest argument in the project for its own thesis: you can outsource the building, but not the inspection — the audit log is only worth what the human verifying it demands.

**Verification:** every change was typechecked, built, and the pipeline was run end-to-end against a real candidate (real HEAD checks, real GitHub fetches, real token usage: ~$0.16/run measured) before being committed.
