-- Replaces the single linear_project_id/linear_project_name columns with a
-- jsonb array -- an operator can legitimately span more than one Linear
-- project (e.g. a POC project alongside an Upgrades/New-Use-Cases project),
-- and bug triage classification should compare against all of them, not
-- just one.
--
-- BetSaracen already has linear_project_id/name set (linked via the old
-- single-project picker), so this carries that value into the new array
-- before dropping the old columns -- a straight drop would silently lose it.
--
-- Each array element is {"id": "<linear project id>", "name": "<linear project name>"}.

alter table public.operators add column if not exists linear_projects jsonb not null default '[]'::jsonb;

update public.operators
set linear_projects = jsonb_build_array(jsonb_build_object('id', linear_project_id, 'name', linear_project_name))
where linear_project_id is not null and jsonb_array_length(linear_projects) = 0;

alter table public.operators
  drop column if exists linear_project_id,
  drop column if exists linear_project_name;
