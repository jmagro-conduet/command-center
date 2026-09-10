-- Replaces the single linear_project_id/linear_project_name columns with a
-- jsonb array -- an operator can legitimately span more than one Linear
-- project (e.g. a POC project alongside an Upgrades/New-Use-Cases project),
-- and bug triage classification should compare against all of them, not
-- just one. No operator has been linked yet (the picker shipped just ahead
-- of this), so there's no data to migrate -- a straight drop-and-replace.
--
-- Each array element is {"id": "<linear project id>", "name": "<linear project name>"}.

alter table public.operators
  drop column if exists linear_project_id,
  drop column if exists linear_project_name,
  add column if not exists linear_projects jsonb not null default '[]'::jsonb;
