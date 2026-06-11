-- Full data reset (run in the Supabase SQL editor).
--
-- Uses TRUNCATE rather than DELETE deliberately: audit_log and
-- reviewer_decisions carry append-only row-level triggers that reject
-- DELETE. TRUNCATE is a table-level operation that bypasses row triggers —
-- the schema's governance stays intact for the application paths while
-- still allowing an explicit admin wipe.
--
-- CASCADE clears dependents (candidate_pii, scores, audit_log, etc.) in
-- one statement. Schema, triggers, and the score_divergence view survive.

truncate table
  candidates,
  evaluation_runs,
  users
cascade;

-- The demo reviewer reseeds itself on the next recorded decision, and the
-- in-code seed candidates reappear on next use. To also restore the seed
-- reviewer now, uncomment:
-- insert into users (email, name, role)
-- values ('connor.brewer@icloud.com', 'Connor Brewer', 'reviewer');
