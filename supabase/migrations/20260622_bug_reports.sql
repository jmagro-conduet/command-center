create table if not exists public.bug_reports (
  id                 uuid        primary key default gen_random_uuid(),
  operator_id        uuid        references public.operators(id),
  ticket_number      text,
  player_input       text,
  suggested_response text,
  expected_outcome   text        not null,
  actual_outcome     text        not null,
  failing_component  text,
  additional_context text,
  mode               text        not null check (mode in ('copilot', 'full_auto')),
  severity           text        not null default 'medium'
                                 check (severity in ('low', 'medium', 'high', 'critical')),
  status             text        not null default 'open'
                                 check (status in ('open', 'investigating', 'resolved', 'wont_fix')),
  reported_by        text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

alter table public.bug_reports enable row level security;

create policy "authenticated_manage_bug_reports"
  on public.bug_reports
  for all to authenticated
  using (true) with check (true);
