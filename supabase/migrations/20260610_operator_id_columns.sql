-- =============================================================================
-- Create operators table + add operator_id to tickets, ticket_issues, users
--
-- operators                  → client companies (BetSaracen, etc.)
-- tickets.operator_id        → scopes each ticket to a client operator
-- ticket_issues.operator_id  → denormalized from ticket for efficient filtering
-- users.operator_id          → links each user to their assigned operator
-- =============================================================================

-- Create operators table if it doesn't already exist
create table if not exists public.operators (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  slug       text not null unique,
  logo_url   text,
  created_at timestamptz not null default now()
);

-- Seed BetSaracen as the initial operator (safe to run multiple times)
insert into public.operators (name, slug)
values ('BetSaracen', 'betsaracen')
on conflict (slug) do nothing;

-- Grants for operators table
grant select on public.operators to authenticated;
grant select, insert, update, delete on public.operators to service_role;

alter table public.operators enable row level security;

create policy "authenticated users can read operators"
  on public.operators for select to authenticated using (true);

-- Add operator_id to tickets
alter table public.tickets
  add column if not exists operator_id uuid references public.operators(id);

-- Add operator_id to ticket_issues (denormalized for efficient filtering)
alter table public.ticket_issues
  add column if not exists operator_id uuid references public.operators(id);

-- Add operator_id to users
alter table public.users
  add column if not exists operator_id uuid references public.operators(id);

-- Indexes
create index if not exists tickets_operator_id_idx       on public.tickets       (operator_id);
create index if not exists ticket_issues_operator_id_idx on public.ticket_issues (operator_id);
create index if not exists users_operator_id_idx         on public.users         (operator_id);
