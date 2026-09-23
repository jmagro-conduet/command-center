-- classify-bug-report used to surface only a single triage match
-- (triage_matched_source/triage_matched_id scalar columns), even when a bug
-- plausibly overlapped with several existing tickets. This adds a jsonb
-- array (capped at 4 entries by the classifier) so the triage panel and
-- draft-bug-ticket can show/cite more than one. Backfills already-triaged
-- rows from the old scalar columns so they don't lose their match after
-- this ships; those old columns are left in place, just no longer written.

alter table public.bug_reports
  add column if not exists triage_matches jsonb;

update public.bug_reports
set triage_matches = jsonb_build_array(
  jsonb_build_object('source', triage_matched_source, 'id', triage_matched_id, 'title', '')
)
where triage_matched_id is not null
  and triage_matched_source is not null
  and triage_matches is null;
