-- =============================================================================
-- Strategy (OKR tracker) -- document store for the ELT-only Strategy page
--
-- Run in the Supabase SQL Editor (or `supabase db query --remote --file`).
-- Safe to re-run. Requires 20261104_roadmap.sql (page_access + has_page_access).
--
-- strategy_docs holds one row per document, keyed by (collection, doc_id):
--   plans       one per OKR period (pillars, objectives, key results)
--   config      'current' -> which period is current
--   sessions    one per ELT meeting (open | review | saved)
--   checkins    one per key result per ELT, plus between-ELT updates
--   actions     numbered actions (ACT-001 ...), with comments
--   proposals   an unsaved, AI-drafted ELT review (admin only until saved)
--   dods        definition-of-done checklists per key result
--
-- Access is the 'strategy' gated page: SuperAdmins always, others only when
-- granted in Admin settings -> Users. Operators (customer logins) never.
-- The page reads and writes through the signed-in user's own client, which is
-- where these policies apply.
-- =============================================================================

create table if not exists public.strategy_docs (
  collection text        not null,
  doc_id     text        not null,
  data       jsonb       not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  updated_by text,
  primary key (collection, doc_id)
);

alter table public.strategy_docs enable row level security;

grant select, insert, update, delete on public.strategy_docs to authenticated;
grant select, insert, update, delete on public.strategy_docs to service_role;

drop policy if exists "strategy read"   on public.strategy_docs;
drop policy if exists "strategy insert" on public.strategy_docs;
drop policy if exists "strategy update" on public.strategy_docs;
drop policy if exists "strategy delete" on public.strategy_docs;

create policy "strategy read"   on public.strategy_docs for select to authenticated
  using (public.has_page_access('strategy', false));
create policy "strategy insert" on public.strategy_docs for insert to authenticated
  with check (public.has_page_access('strategy', true));
create policy "strategy update" on public.strategy_docs for update to authenticated
  using (public.has_page_access('strategy', true))
  with check (public.has_page_access('strategy', true));
create policy "strategy delete" on public.strategy_docs for delete to authenticated
  using (public.has_page_access('strategy', true));

create index if not exists strategy_docs_collection_idx on public.strategy_docs (collection);
