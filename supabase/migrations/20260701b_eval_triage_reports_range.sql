-- Replace the window_mode enum (latest/90d/all "lanes", each with its own history) with
-- a real date range per report: range_start/range_end (either may be null = open-ended)
-- plus a range_label snapshot for display. This collapses the per-window lanes into one
-- flat timeline per operator+section — "latest" is just the newest row regardless of what
-- range it used, and History lists every run with its own range. Lets the Generate flow
-- offer presets (Today / 7d / 30d / 90d / All time) AND a true custom date range.
alter table public.eval_triage_reports add column if not exists range_start timestamptz;
alter table public.eval_triage_reports add column if not exists range_end timestamptz;
alter table public.eval_triage_reports add column if not exists range_label text;

-- Backfill: every existing row was generated under the old 'all' window — label it as
-- such (range_start/range_end stay null, meaning fully open-ended, same semantics as 'all').
update public.eval_triage_reports
set range_label = 'All time'
where range_label is null;

alter table public.eval_triage_reports drop column if exists window_mode;

drop index if exists idx_eval_triage_reports_lookup;
create index if not exists idx_eval_triage_reports_lookup
  on public.eval_triage_reports (operator_id, section, generated_at desc);
