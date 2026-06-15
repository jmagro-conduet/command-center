-- Issue-level columns on ticket_issues.
--
-- Why: Command Center manual submissions categorize at the TICKET level
-- (tickets.ticket_category). The Metabase / Copilot export categorizes at the
-- ISSUE level — each suggestion event in a ticket can have its own category
-- (first_agent_message, withdrawal_problem, end_chat, ...). To preserve that we
-- need a per-issue category column, plus provenance + the edit-magnitude signal.

alter table public.ticket_issues
  -- Per-issue category (Metabase "Category"). NULL for manual/Bolt rows, whose
  -- category lives at the ticket level in tickets.ticket_category.
  add column if not exists issue_category  text,
  -- Objective edit magnitude 0–100 from the Metabase export ("Character similarity").
  add column if not exists char_similarity smallint,
  -- Provenance / data grain:
  --   'manual'          — agent logged it in Command Center (has agent identity)
  --   'bolt_import'     — historical Bolt CSV import
  --   'metabase_import' — Metabase/Copilot suggestion-quality import (no agent identity)
  add column if not exists source          text default 'manual';

-- Backfill: everything that exists today predates the Metabase flow.
update public.ticket_issues set source = 'manual' where source is null;

create index if not exists idx_ticket_issues_source
  on public.ticket_issues (source);

create index if not exists idx_ticket_issues_issue_category
  on public.ticket_issues (issue_category)
  where issue_category is not null;
