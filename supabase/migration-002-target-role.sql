-- Migration 002: anchor evaluations to the two roles in the assignment brief.
-- Run once in the Supabase SQL editor (schema.sql includes this for fresh installs).

alter table evaluation_runs
  add column if not exists target_role text not null default 'senior-consultant'
  check (target_role in ('senior-consultant', 'manager'));
