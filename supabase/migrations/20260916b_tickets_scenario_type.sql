-- Alongside the Scenario tag, lets a Full Auto submission be classified by
-- what kind of test case it represents -- the other half of checking test
-- variety/volume: not just "what happened" but "did we cover happy paths,
-- edge cases, out-of-scope handling, and cross-cutting scenarios, or just
-- one of those repeatedly."

alter table public.tickets
  add column if not exists scenario_type text
  check (scenario_type in ('happy_path', 'edge_case', 'out_of_scope', 'cross_cutting'));
