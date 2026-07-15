-- Lets an admin acknowledge a known Data Health issue (e.g. the eval backlog
-- from a past credit outage) without fixing the underlying data immediately.
-- Dismissal is threshold-based, not permanent: it stores the issue's count at
-- dismissal time, and the issue automatically resurfaces if that count grows
-- past what was acknowledged -- so a dismissed issue can't silently mask a
-- problem that's actively getting worse.

create table if not exists public.data_health_dismissals (
  issue_key text primary key,
  dismissed_count int not null,
  dismissed_by text,
  dismissed_at timestamptz not null default now()
);

alter table public.data_health_dismissals enable row level security;

create policy authenticated_manage_data_health_dismissals
  on public.data_health_dismissals for all to authenticated using (true);
