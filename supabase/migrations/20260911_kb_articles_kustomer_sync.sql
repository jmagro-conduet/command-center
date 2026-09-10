-- Lets kustomer-kb-sync upsert idempotently on every recurring run instead of
-- creating duplicate rows each time. external_id is the Kustomer article id
-- (globally unique within Kustomer), external_source distinguishes future
-- non-Kustomer sync sources the same way, and external_updated_at carries
-- Kustomer's own version timestamp for reference/debugging.

alter table public.kb_articles
  add column if not exists external_source text,
  add column if not exists external_id text,
  add column if not exists external_updated_at timestamptz;

create unique index if not exists kb_articles_external_source_id_idx
  on public.kb_articles (external_source, external_id)
  where external_source is not null;
