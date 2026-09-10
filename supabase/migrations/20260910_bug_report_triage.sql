-- Bug ticket triage assistant: reduces the cognitive load of deciding
-- whether a newly reported bug is a brand-new issue, related-but-distinct,
-- a duplicate/supporting instance of something already tracked, or a
-- possible non-issue (e.g. expected behavior given a known content/policy
-- gap -- a real, recurring pattern from RSI UAT).
--
-- canonical_bug_id lets a duplicate bug_reports row point at the ORIGINAL
-- bug_reports row it's a supporting instance of (self-referencing, mirrors
-- the Full Auto snapshot use_case pattern). linear_issue_id/url are set once
-- a bug (usually the canonical one) actually has a real Linear ticket.
-- triage_status/reasoning/matched_source record the last triage call's
-- result (or a reviewer's manual override) for that bug_reports row.

alter table public.bug_reports
  add column if not exists canonical_bug_id uuid references public.bug_reports(id),
  add column if not exists linear_issue_id text,
  add column if not exists linear_issue_url text,
  add column if not exists triage_status text check (triage_status in ('new', 'related', 'duplicate', 'possible_non_issue')),
  add column if not exists triage_reasoning text,
  add column if not exists triage_matched_source text check (triage_matched_source in ('linear', 'command_center')),
  add column if not exists triage_matched_id text,
  add column if not exists triaged_at timestamptz;

create index if not exists bug_reports_canonical_bug_id_idx on public.bug_reports (canonical_bug_id);
