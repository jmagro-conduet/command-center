-- tickets/ticket_issues were built entirely around CoPilot's edit-grading
-- model (issue_type, suggested_response, final_edits) -- every page that
-- reads ticket_issues (Submissions, Leaderboard, Analytics, Bulletin,
-- Report, ExecutiveSummary's copilot view) computes its quality percentages
-- by summing exactly the 4 known issue_type buckets as the denominator, not
-- rows.length. A Full Auto submission has no draft-to-edit step, so it has
-- no issue_type to log -- inserting one into ticket_issues with an empty or
-- different issue_type would silently corrupt those denominators as Full
-- Auto volume grows, with no crash or visible sign anything was wrong.
--
-- Full Auto logging is deliberately much lighter than CoPilot (ticket
-- number, category, optional external id -- "the submission is just the DB
-- reference"), so it doesn't need a ticket_issues row at all. mode lets a
-- Full Auto submission live in `tickets` alone; every existing CoPilot page
-- keeps working unchanged since it queries ticket_issues with tickets!inner
-- -- a tickets row with no ticket_issues row is invisible to those queries
-- already. external_ticket_id is the Full Auto submission's optional unique
-- id (CoPilot's equivalent already lives per-issue on ticket_issues, so this
-- only applies to full_auto rows).

alter table public.tickets
  add column if not exists mode text not null default 'copilot' check (mode in ('copilot', 'full_auto')),
  add column if not exists external_ticket_id text;
