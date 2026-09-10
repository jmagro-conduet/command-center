-- Fixes the previous migration's partial unique index -- Postgres won't
-- match a partial index ("where external_source is not null") against a
-- plain ON CONFLICT (external_source, external_id) target the way PostgREST
-- issues its upserts (error 42P10: "no unique or exclusion constraint
-- matching the ON CONFLICT specification"). A plain unique constraint works
-- fine here instead: every existing row has both columns NULL, and NULLs
-- never conflict with each other under a unique constraint.

drop index if exists public.kb_articles_external_source_id_idx;

alter table public.kb_articles
  add constraint kb_articles_external_source_id_key unique (external_source, external_id);
