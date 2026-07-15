-- Logs every "Ask the Operator" Q&A pair. Not surfaced in any UI yet -- this is
-- quiet data capture for a future admin view surfacing frequent questions and
-- KB gaps (coverage != 'full' rows are the interesting ones to look at later).
create table if not exists public.ask_operator_logs (
  id             uuid primary key default gen_random_uuid(),
  operator_id    uuid not null references public.operators(id),
  user_id        uuid references public.users(id),
  question       text not null,
  answer         text not null,
  coverage       text not null check (coverage in ('full', 'partial', 'none')),
  source_ids     uuid[] not null default '{}',
  excluded_count int not null default 0,
  created_at     timestamptz not null default now()
);

create index if not exists ask_operator_logs_operator_idx on public.ask_operator_logs (operator_id, created_at desc);

alter table public.ask_operator_logs enable row level security;

create policy "authenticated_manage_ask_operator_logs"
  on public.ask_operator_logs
  for all to authenticated
  using (true) with check (true);
