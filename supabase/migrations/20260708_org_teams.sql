-- Org-teams (e.g. "Manila", "Cebu") — sub-teams within an operator, used to filter
-- Submissions / Leaderboard / Analytics by team and to scope which teams a given
-- lead can filter to. Deliberately named org_teams / org_team_id to avoid colliding
-- with the pre-existing operator_team (free-text signup label mirroring the home
-- operator's name) and operator_teams (flat signup dropdown list) — those are a
-- different, unrelated concept. Purely additive: new table + one nullable FK column,
-- no existing column semantics touched.
create table if not exists public.org_teams (
  id            uuid        primary key default gen_random_uuid(),
  operator_id   uuid        not null references public.operators(id) on delete cascade,
  name          text        not null,
  lead_user_id  uuid        references public.users(id) on delete set null,
  created_at    timestamptz not null default now(),
  unique (operator_id, name)
);

alter table public.users
  add column if not exists org_team_id uuid references public.org_teams(id) on delete set null;

create index if not exists org_teams_operator_idx on public.org_teams (operator_id);
create index if not exists users_org_team_idx on public.users (org_team_id);

alter table public.org_teams enable row level security;

create policy "authenticated_manage_org_teams"
  on public.org_teams
  for all to authenticated
  using (true) with check (true);
