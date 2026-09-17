-- Optional outcome field for Full Auto: was this a full win either way --
-- gameLM handled it completely on its own, or it correctly recognized it
-- needed a human and escalated cleanly. Distinct from scenario_type (what
-- KIND of test case this is) and the Scenario tag (what happened) -- this is
-- just "did it go well," left blank when that's not a clean yes either way.

alter table public.tickets
  add column if not exists success text
  check (success in ('fully_automated', 'escalated_successfully'));
