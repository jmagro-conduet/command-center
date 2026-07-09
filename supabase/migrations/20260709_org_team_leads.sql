-- Multiple leads per org-team (managers and leads both need filter visibility,
-- not just one person). Migrates any existing single lead_user_id into the new
-- join table first, then drops the now-redundant column — org_team_leads becomes
-- the single source of truth for "who can filter to this team".
create table if not exists public.org_team_leads (
  team_id  uuid not null references public.org_teams(id) on delete cascade,
  user_id  uuid not null references public.users(id) on delete cascade,
  primary key (team_id, user_id)
);

insert into public.org_team_leads (team_id, user_id)
select id, lead_user_id from public.org_teams where lead_user_id is not null
on conflict do nothing;

alter table public.org_teams drop column if exists lead_user_id;

create index if not exists org_team_leads_user_idx on public.org_team_leads (user_id);

alter table public.org_team_leads enable row level security;

create policy "authenticated_manage_org_team_leads"
  on public.org_team_leads
  for all to authenticated
  using (true) with check (true);
