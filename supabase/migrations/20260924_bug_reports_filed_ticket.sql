-- Status now carries both bug lifecycle (open/investigating/resolved/
-- wont_fix) and linkage (duplicate/related), which left no way to answer a
-- distinct question: "did I file my own engineering ticket for this bug?"
-- linear_issue_url only ever gets set when confirming a match to an
-- EXISTING ticket (see BugTracker.tsx's confirmMatch) -- never when a
-- reviewer creates a brand-new one from a draft. These columns are a
-- separate, independent field for exactly that -- logged manually since
-- Linear write access isn't wired up yet (see draft-bug-ticket).

alter table public.bug_reports
  add column if not exists filed_ticket_id text,
  add column if not exists filed_ticket_url text,
  add column if not exists filed_at timestamptz;
