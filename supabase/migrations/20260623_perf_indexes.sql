-- Performance: composite indexes for the operator + date-range filtered reads that
-- back the Leaderboard, Analytics, Executive Summary, and Report Card pages.
-- Those pages filter ticket_issues / tickets by operator_id AND created_at and order
-- by created_at, so a (operator_id, created_at DESC) index turns a sequential scan
-- into an index range-scan. Tables are modest, so a plain CREATE INDEX is fine; if
-- they grow large, switch to CREATE INDEX CONCURRENTLY (run outside a transaction).
--
-- ticket_issue_reviews lookups by ticket_issue_id are already covered by the existing
-- UNIQUE (ticket_issue_id, eval_type) constraint index, so no new index needed there.

CREATE INDEX IF NOT EXISTS ticket_issues_operator_created_idx
  ON public.ticket_issues (operator_id, created_at DESC);

CREATE INDEX IF NOT EXISTS tickets_operator_created_idx
  ON public.tickets (operator_id, created_at DESC);
