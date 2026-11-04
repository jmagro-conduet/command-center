-- =============================================================================
-- Product Roadmap (ELT-only) -- per-user page access + document store
--
-- Run in the Supabase SQL Editor (or `supabase db push`). Safe to re-run.
--
-- 1. page_access      who can open a gated page (and whether they can edit it).
--                     Managed from Admin settings -> Users by a SuperAdmin.
-- 2. has_page_access  SQL helper used by RLS. SuperAdmins always pass; the
--                     operator role never does (operators are customers).
-- 3. roadmap_docs     the roadmap's data: one row per document, keyed by
--                     (collection, doc_id). Same shape the original roadmap
--                     artifact used, so its data and sync logic port 1:1.
--
-- NOTE: the app's service-role client bypasses RLS (see src/lib/supabase.ts).
-- The roadmap page reads/writes through the signed-in user's own client
-- (authClient), which is where these policies apply.
-- =============================================================================

create table if not exists public.page_access (
  page_key   text        not null,
  user_id    uuid        not null,
  can_edit   boolean     not null default false,
  granted_by text,
  created_at timestamptz not null default now(),
  primary key (page_key, user_id)
);

alter table public.page_access enable row level security;
-- No authenticated policies on purpose: grants are read and written by the
-- app's service client (same as the users table).
grant select, insert, update, delete on public.page_access to service_role;

create or replace function public.has_page_access(p_page text, p_need_edit boolean default false)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.users u
    where lower(u.email) = lower(auth.jwt() ->> 'email')
      and u.role <> 'operator'
      and (
        u.role = 'superadmin'
        or exists (
          select 1 from public.page_access pa
          where pa.user_id = u.id
            and pa.page_key = p_page
            and (not p_need_edit or pa.can_edit)
        )
      )
  );
$$;

grant execute on function public.has_page_access(text, boolean) to authenticated;

create table if not exists public.roadmap_docs (
  collection text        not null,
  doc_id     text        not null,
  data       jsonb       not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  updated_by text,
  primary key (collection, doc_id)
);

alter table public.roadmap_docs enable row level security;

grant select, insert, update, delete on public.roadmap_docs to authenticated;
grant select, insert, update, delete on public.roadmap_docs to service_role;

drop policy if exists "roadmap read"   on public.roadmap_docs;
drop policy if exists "roadmap insert" on public.roadmap_docs;
drop policy if exists "roadmap update" on public.roadmap_docs;
drop policy if exists "roadmap delete" on public.roadmap_docs;

create policy "roadmap read"   on public.roadmap_docs for select to authenticated
  using (public.has_page_access('roadmap', false));
create policy "roadmap insert" on public.roadmap_docs for insert to authenticated
  with check (public.has_page_access('roadmap', true));
create policy "roadmap update" on public.roadmap_docs for update to authenticated
  using (public.has_page_access('roadmap', true))
  with check (public.has_page_access('roadmap', true));
create policy "roadmap delete" on public.roadmap_docs for delete to authenticated
  using (public.has_page_access('roadmap', true));

create index if not exists roadmap_docs_collection_idx on public.roadmap_docs (collection);
