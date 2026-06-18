-- Stores agent's suggested improvements for Perfect responses
-- (gameLM was good enough to send as-is, but agent notes what could be better)
alter table public.ticket_issues
  add column if not exists enhancement_note text;
