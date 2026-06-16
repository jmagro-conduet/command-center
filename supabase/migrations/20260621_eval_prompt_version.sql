-- Prompt-version stamp per eval type.
--
-- Why: the eval prompts are iterated frequently. Re-scoring all history after
-- every change is too slow/costly. Instead, each eval stamps the row with the
-- version of the prompt that scored it, and the Report Card surfaces only the
-- latest version per eval type. Legacy (old-prompt) scores stay in the DB but
-- drop out of the default metrics automatically — no wipe, no forced re-score.
--
-- The version string lives in each _shared prompt file (bump it when you edit
-- the prompt). To seed a fresh version with immediate data, run a scoped
-- backfill — it re-scores and stamps the current version.

alter table public.ticket_issues
  add column if not exists accuracy_prompt_version text,
  add column if not exists quality_prompt_version  text,
  add column if not exists edit_prompt_version     text;

create index if not exists idx_ti_accuracy_prompt_version
  on public.ticket_issues (accuracy_prompt_version) where accuracy_prompt_version is not null;
create index if not exists idx_ti_quality_prompt_version
  on public.ticket_issues (quality_prompt_version)  where quality_prompt_version is not null;
create index if not exists idx_ti_edit_prompt_version
  on public.ticket_issues (edit_prompt_version)     where edit_prompt_version is not null;
