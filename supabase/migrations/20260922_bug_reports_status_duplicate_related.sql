-- Adds 'duplicate' and 'related' as real statuses on bug_reports, alongside
-- the existing open/investigating/resolved/wont_fix -- so the Bug Tracker
-- list shows at a glance that a bug is being addressed via another ticket,
-- not just left sitting open. Settable manually like any other status, and
-- also set automatically when a reviewer confirms a triage match (see
-- BugTracker.tsx's confirmMatch).

alter table public.bug_reports drop constraint if exists bug_reports_status_check;

alter table public.bug_reports
  add constraint bug_reports_status_check
  check (status in ('open', 'investigating', 'resolved', 'wont_fix', 'duplicate', 'related'));
