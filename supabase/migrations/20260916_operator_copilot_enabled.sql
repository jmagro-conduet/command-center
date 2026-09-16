-- Lets an operator's LogTicket page be scoped to just CoPilot, just Full
-- Auto, or both -- so an agent working an operator that's gone Full-Auto-only
-- (e.g. Modo) doesn't see the CoPilot edit-grading flow at all. Reuses the
-- existing full_auto_enabled flag (already true for any operator with a
-- Full Auto rollout) as the Full Auto half of that decision; this adds the
-- CoPilot half. Defaults true so every existing operator's behavior is
-- completely unchanged -- CoPilot has always been the unconditional default.

alter table public.operators
  add column if not exists copilot_enabled boolean not null default true;
