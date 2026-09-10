-- Which Linear project a given operator's bug reports should be compared
-- against for triage classification. Not a rigid operator+mode formula --
-- live data shows RSI split CoPilot/Full Auto into two separate projects
-- while BetSaracen uses one project for both, so this needs to stay an
-- explicit per-operator admin choice, same pattern as zendesk_brand_id.

alter table public.operators add column if not exists linear_project_id text;
alter table public.operators add column if not exists linear_project_name text;
