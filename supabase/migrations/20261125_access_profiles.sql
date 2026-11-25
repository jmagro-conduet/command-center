-- =============================================================================
-- Access profiles: configurable page access per role, with per-user overrides
--
-- Run in the Supabase SQL Editor (or `supabase db query --remote --file`). Safe to re-run.
-- Requires 20261104_roadmap.sql (page_access, has_page_access).
--
-- Model (mirrors src/lib/access/core.ts):
--   access_profiles       named bundles of page access. Built-ins: agent, qa, admin,
--                         superadmin, operator (seeded to match what those roles could
--                         already open). Admins can edit them and add their own.
--   access_profile_pages  profile x page -> 'view' | 'edit'. No row = no access.
--   users.access_profile  optional; null = "the profile named after my role".
--   page_access           per-user OVERRIDES. level 'none' | 'view' | 'edit' beats the
--                         profile (so it can remove a page as well as add one).
--
-- Roadmap and Strategy data are protected by row-level security through
-- has_page_access(), which now resolves a user's level through all of the above.
-- Seeded defaults keep every existing user's access exactly as it was.
-- =============================================================================

alter table public.users add column if not exists access_profile text;

create table if not exists public.access_profiles (
  key         text        primary key,
  name        text        not null,
  description text        not null default '',
  built_in    boolean     not null default false,
  locked      boolean     not null default false,   -- operator: cannot be edited
  created_by  text,
  created_at  timestamptz not null default now()
);

create table if not exists public.access_profile_pages (
  profile_key text not null references public.access_profiles(key) on delete cascade,
  page_key    text not null,
  level       text not null check (level in ('view', 'edit')),
  primary key (profile_key, page_key)
);

alter table public.access_profiles      enable row level security;
alter table public.access_profile_pages enable row level security;
-- Like page_access: no authenticated policies; the app's service client reads and writes them.
grant select, insert, update, delete on public.access_profiles      to service_role;
grant select, insert, update, delete on public.access_profile_pages to service_role;

-- per-user overrides can now also deny
alter table public.page_access add column if not exists level text;
update public.page_access set level = case when can_edit then 'edit' else 'view' end where level is null;
alter table public.page_access drop constraint if exists page_access_level_check;
alter table public.page_access add constraint page_access_level_check check (level in ('none', 'view', 'edit'));

-- ---- seed the built-in profiles (never overwrites what an admin has since changed)
insert into public.access_profiles (key, name, description, built_in, locked) values
  ('agent',      'Agent',      'Support agents.',                  true, false),
  ('qa',         'QA',         'Quality reviewers.',               true, false),
  ('admin',      'Admin',      'Team admins.',                     true, false),
  ('superadmin', 'SuperAdmin', 'Owners. Everything by default.',   true, false),
  ('operator',   'Operator',   'Customer logins. Fixed.',          true, true)
on conflict (key) do nothing;

insert into public.access_profile_pages (profile_key, page_key, level)
select p, pg, 'view' from (values
  ('agent','log-ticket'),('agent','bulletin'),('agent','leaderboard'),('agent','bug-tracker'),('agent','learn'),
  ('qa','log-ticket'),('qa','bulletin'),('qa','leaderboard'),('qa','report-card'),('qa','bug-tracker'),('qa','learn'),
  ('admin','log-ticket'),('admin','bulletin'),('admin','leaderboard'),('admin','submissions'),('admin','executive-summary'),
  ('admin','analytics'),('admin','report-card'),('admin','bug-tracker'),('admin','learn'),
  ('operator','executive-summary')
) as t(p, pg)
on conflict (profile_key, page_key) do nothing;

insert into public.access_profile_pages (profile_key, page_key, level)
select 'superadmin', pg, case when pg in ('roadmap', 'strategy') then 'edit' else 'view' end
from unnest(array['log-ticket','bulletin','leaderboard','submissions','executive-summary','analytics','report-card',
                  'eval-reports','bug-tracker','roadmap','strategy','learn','users','admin-settings']) as pg
on conflict (profile_key, page_key) do nothing;

-- ---- resolver: none | view | edit for one person (by email) and one page
create or replace function public.page_level_for_email(p_email text, p_page text)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  u    record;
  prof text;
  ov   text;
  lvl  text;
begin
  select id, role, access_profile into u from public.users where lower(email) = lower(p_email) limit 1;
  if not found then return 'none'; end if;

  if u.role = 'operator' then   -- operators are fixed: the operator profile only, no overrides
    select level into lvl from public.access_profile_pages where profile_key = 'operator' and page_key = p_page;
    return coalesce(lvl, 'none');
  end if;

  -- level is null on rows written before this migration's app release: fall back to can_edit
  select coalesce(level, case when can_edit then 'edit' else 'view' end) into ov
    from public.page_access where user_id = u.id and page_key = p_page;
  if ov is not null then return ov; end if;

  prof := coalesce(u.access_profile, u.role);
  select level into lvl from public.access_profile_pages where profile_key = prof and page_key = p_page;
  return coalesce(lvl, 'none');
end;
$$;
revoke all on function public.page_level_for_email(text, text) from public, anon, authenticated;
grant execute on function public.page_level_for_email(text, text) to service_role;

-- ---- RLS helper used by roadmap_docs / strategy_docs, now profile-aware
create or replace function public.has_page_access(p_page text, p_need_edit boolean default false)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case when p_need_edit
              then public.page_level_for_email(auth.jwt() ->> 'email', p_page) = 'edit'
              else public.page_level_for_email(auth.jwt() ->> 'email', p_page) in ('view', 'edit')
         end;
$$;
grant execute on function public.has_page_access(text, boolean) to authenticated;
