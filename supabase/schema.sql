-- ============================================================================
-- AI Builder Evaluator — Supabase schema
--
-- The governance model is enforced HERE, not just in application code:
--   1. PII is quarantined in candidate_pii. Evaluation queries never join it;
--      only the de-blind endpoint reads it. Blinding is a schema boundary.
--   2. audit_log is append-only (trigger-enforced). History cannot be edited.
--   3. reviewer_decisions: exactly one per run (PK), immutable once written,
--      rationale required by CHECK — the human call is recorded, never revised
--      silently, and never readable by the pipeline (no FK from any agent
--      table points at it).
--   4. scores carry their citation and confidence as NOT NULL columns —
--      an uncited score is unrepresentable.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- users — reviewers. No auth flow in the demo; seeded with one reviewer row.
-- ---------------------------------------------------------------------------
create table users (
  id          uuid primary key default gen_random_uuid(),
  email       text unique not null,
  name        text not null,
  role        text not null default 'reviewer'
              check (role in ('reviewer', 'admin')),
  created_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- candidates — deliberately PII-free. Everything joinable to evaluation
-- data lives here; everything identifying lives in candidate_pii.
-- ---------------------------------------------------------------------------
create table candidates (
  id          text primary key,                 -- slug, e.g. 'connor-brewer'
  mode        text not null
              check (mode in ('live', 'synthetic')),
  source      text not null default 'resume'
              check (source in ('resume', 'seed')), -- resume-extracted vs synthetic seed
  created_at  timestamptz not null default now()
);

-- PII quarantine: 1:1 with candidates. The ONLY table holding name/photo/
-- education. Read by UI queries (roster, scorecard header) — never by the
-- code path that assembles LLM inputs. Blinding is model-facing.
create table candidate_pii (
  candidate_id  text primary key references candidates(id) on delete cascade,
  name          text not null,
  email         text,
  education     jsonb not null default '[]',
  resume_path   text                            -- Supabase Storage path of the uploaded PDF;
                                                -- the raw resume is PII, so it lives in the quarantine zone
);

create table candidate_links (
  id              bigint generated always as identity primary key,
  candidate_id    text not null references candidates(id) on delete cascade,
  kind            text not null
                  check (kind in ('github', 'linkedin', 'portfolio', 'other')),
  url             text not null,
  claimed_handle  text not null
);

create table candidate_projects (
  id            bigint generated always as identity primary key,
  candidate_id  text not null references candidates(id) on delete cascade,
  title         text not null,
  description   text not null,
  url           text,
  repo_url      text
);

create table candidate_evidence (
  id            bigint generated always as identity primary key,
  candidate_id  text not null references candidates(id) on delete cascade,
  kind          text not null
                check (kind in ('code', 'demo', 'writeup', 'case-study')),
  title         text not null,
  body          text not null,
  url           text
);

-- ---------------------------------------------------------------------------
-- evaluation_runs — one row per pipeline execution.
-- jsonb is used only for genuinely document-shaped artifacts (the blinded
-- packet as the assessor saw it, the token map, transparency summary);
-- everything queryable is relational.
-- ---------------------------------------------------------------------------
create table evaluation_runs (
  id               text primary key,            -- e.g. 'run_3f2a…'
  candidate_id     text not null references candidates(id),
  status           text not null default 'running'
                   check (status in ('running', 'complete', 'error')),
  model            text not null,               -- exact model ID, disclosed in UI
  pricing_version  text not null,               -- pricing table stamp for honest cost math
  blinded_packet   jsonb,                       -- BlindedEvidencePacket, verbatim
  token_map        jsonb,                       -- token → identity; never enters an LLM call
  synthesis        jsonb,                       -- SynthesizerBrief
  transparency     jsonb,                       -- TransparencySummary
  total_cost_usd   numeric(10, 4) not null default 0,
  error_message    text,
  started_at       timestamptz not null default now(),
  completed_at     timestamptz
);

create index idx_runs_candidate on evaluation_runs (candidate_id, started_at desc);

-- ---------------------------------------------------------------------------
-- verification_checks — deterministic facts (checks.ts output). One row per
-- HEAD request / GitHub fetch / identity-link check. `source` keeps the
-- fixture-vs-live distinction auditable per fact.
-- ---------------------------------------------------------------------------
create table verification_checks (
  id          bigint generated always as identity primary key,
  run_id      text not null references evaluation_runs(id) on delete cascade,
  agent       text not null
              check (agent in ('projectVerifier', 'identityVerifier')),
  kind        text not null
              check (kind in ('url_liveness', 'github_repo', 'identity_link')),
  source      text not null
              check (source in ('live', 'fixture')),
  target      text not null,                    -- URL or repo checked
  passed      boolean,                          -- live? verified? (null = inconclusive)
  latency_ms  integer,
  detail      jsonb not null default '{}'       -- status code, commit count, mismatch reason…
);

-- ---------------------------------------------------------------------------
-- agent_outputs — full structured output of each LLM call, per pass.
-- The consistency check is two assessor passes: (run_id, agent, pass) unique.
-- ---------------------------------------------------------------------------
create table agent_outputs (
  id          bigint generated always as identity primary key,
  run_id      text not null references evaluation_runs(id) on delete cascade,
  agent       text not null
              check (agent in ('projectVerifier', 'evidenceAssessor',
                               'identityVerifier', 'synthesizer')),
  pass        smallint not null default 1 check (pass in (1, 2)),
  confidence  text not null check (confidence in ('high', 'medium', 'low')),
  result      jsonb not null,                   -- schema-validated upstream
  unique (run_id, agent, pass)
);

-- ---------------------------------------------------------------------------
-- scores — one row per (run, dimension, assessor pass). Citation and
-- confidence are NOT NULL: an unsupported score cannot exist.
-- ---------------------------------------------------------------------------
create table scores (
  id          bigint generated always as identity primary key,
  run_id      text not null references evaluation_runs(id) on delete cascade,
  pass        smallint not null check (pass in (1, 2)),
  dimension   text not null
              check (dimension in ('workflow-thinking', 'end-to-end-ownership',
                                   'ambiguity', 'responsible-ai')),
  score       smallint not null check (score between 1 and 5),
  citation    text not null,                    -- verbatim quote from blinded evidence
  rationale   text not null,
  confidence  text not null check (confidence in ('high', 'medium', 'low')),
  unique (run_id, dimension, pass)
);

-- Divergence is derived, not stored — single source of truth.
-- Flagged when the two assessor passes differ by more than 1 point.
create view score_divergence as
select
  run_id,
  dimension,
  max(score) - min(score)      as delta,
  (max(score) - min(score)) > 1 as divergent
from scores
group by run_id, dimension;

-- ---------------------------------------------------------------------------
-- audit_log — every consequential action: LLM calls (with token/cost detail),
-- HTTP checks, blinding, fixture substitutions, and reviewer actions.
-- actor_user_id NULL = the system; set = a human (de-blind, decision).
-- APPEND-ONLY: updates and deletes are blocked at the database level.
-- ---------------------------------------------------------------------------
create table audit_log (
  id                 bigint generated always as identity primary key,
  run_id             text references evaluation_runs(id) on delete cascade,
  candidate_id       text references candidates(id) on delete cascade,
  -- intake extraction happens before any run exists → run_id null, candidate_id set.
  -- every entry must anchor to at least one of the two.
  constraint audit_anchor check (run_id is not null or candidate_id is not null),
  ts                 timestamptz not null default now(),
  stage              text not null,
  kind               text not null
                     check (kind in ('llm_call', 'http_check', 'blinding',
                                     'fixture', 'intake', 'reviewer_action')),
  actor_user_id      uuid references users(id), -- null = system
  model              text,                      -- llm_call only
  input_tokens       integer,
  output_tokens      integer,
  cache_read_tokens  integer,
  cache_write_tokens integer,
  cost_usd           numeric(10, 6),
  duration_ms        integer,
  input_digest       text,                      -- sha256 of exact agent input
  summary            text not null
);

create index idx_audit_run on audit_log (run_id, ts);

create or replace function forbid_mutation() returns trigger
language plpgsql as $$
begin
  raise exception '% is append-only', tg_table_name;
end $$;

create trigger audit_log_append_only
  before update or delete on audit_log
  for each row execute function forbid_mutation();

-- ---------------------------------------------------------------------------
-- reviewer_decisions — the human call. Exactly one per run (PK = run_id),
-- rationale mandatory, immutable once written. Changing your mind = a new
-- run, not an edited record.
-- ---------------------------------------------------------------------------
create table reviewer_decisions (
  run_id         text primary key references evaluation_runs(id) on delete cascade,
  user_id        uuid not null references users(id),
  decision       text not null
                 check (decision in ('advance', 'hold', 'decline')),
  rationale      text not null check (char_length(rationale) >= 20),
  created_at     timestamptz not null default now()
);

create trigger reviewer_decisions_immutable
  before update or delete on reviewer_decisions
  for each row execute function forbid_mutation();

-- ---------------------------------------------------------------------------
-- Access model: service-role key from route handlers only; the browser never
-- talks to Supabase. RLS intentionally not enabled (single-trust-boundary
-- demo) — documented as a deliberate cut.
-- ---------------------------------------------------------------------------

-- Seed: the demo reviewer
insert into users (email, name, role)
values ('connor.brewer@icloud.com', 'Connor Brewer', 'reviewer');
