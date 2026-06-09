-- =============================================================================
-- Seed operators table from operator_teams
--
-- operator_teams entries ARE the client operators Conduet supports.
-- This migration syncs them into the operators table so they appear in the
-- sidebar switcher and can be assigned to users/tickets.
-- BetSaracen was already seeded in 20260610 — on conflict do nothing handles it.
-- =============================================================================

insert into public.operators (name, slug)
select
  name,
  lower(regexp_replace(trim(name), '[^a-zA-Z0-9]+', '-', 'g')) as slug
from public.operator_teams
where name is not null and trim(name) <> ''
on conflict (slug) do nothing;
