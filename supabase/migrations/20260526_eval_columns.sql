-- =============================================================================
-- Eval columns for AI-powered edit validity scoring (Signal 1)
-- and ZD transcript fields for completeness + input accuracy (Signals 2 & 3)
-- =============================================================================

-- Signal 1: eval verdict per ticket_issues row (Majority/Partial edits only)
alter table public.ticket_issues
  add column if not exists eval_verdict    text,           -- CORRECTION | ENHANCEMENT | PREFERENCE
  add column if not exists eval_confidence integer,        -- 0–100
  add column if not exists eval_reasoning  text,           -- one-to-two sentence explanation
  add column if not exists eval_ran_at     timestamptz;    -- when the eval was last run

-- Signals 2 & 3: ZD transcript data fetched at ticket submission time
alter table public.tickets
  add column if not exists zd_created_at     timestamptz,  -- ZD ticket creation date (fixes date alignment)
  add column if not exists zd_message_count  integer;      -- # of player messages in ZD transcript

-- Index for fast report card queries
create index if not exists idx_ticket_issues_eval_verdict
  on public.ticket_issues (eval_verdict)
  where eval_verdict is not null;
