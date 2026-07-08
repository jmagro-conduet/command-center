-- AI-generated engineering reports for the Bug Tracker: per-bug resolution briefs
-- (description / steps to reproduce / suggested fix / expected / actual / impact)
-- plus a cross-cutting root-cause "themes" pass across all open bugs. One row per
-- generation run, scoped to an operator, kept as history (mirrors eval_triage_reports).
create table if not exists public.bug_triage_reports (
  id            uuid        primary key default gen_random_uuid(),
  operator_id   uuid        references public.operators(id),
  generated_at  timestamptz not null default now(),
  generated_by  text,
  bug_count     int         not null default 0,
  statuses      text[]      not null default array['open', 'investigating'],
  briefs        jsonb       not null default '[]'::jsonb,
  themes        jsonb       not null default '[]'::jsonb,
  usage         jsonb,
  meta          jsonb       not null default '{}'::jsonb
);

create index if not exists bug_triage_reports_operator_idx
  on public.bug_triage_reports (operator_id, generated_at desc);

alter table public.bug_triage_reports enable row level security;

create policy "authenticated_manage_bug_triage_reports"
  on public.bug_triage_reports
  for all to authenticated
  using (true) with check (true);
