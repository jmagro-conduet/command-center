-- Persisted engineering triage reports — one shared snapshot per (operator, section)
-- so every SuperAdmin sees the same report (with a "last generated" timestamp) instead
-- of each person re-running the LLM. Regenerate upserts a fresh snapshot on demand.
create table if not exists public.eval_triage_reports (
  operator_id  uuid        not null,
  section      text        not null,
  aggregates   jsonb,
  synthesis    jsonb,
  generated_at timestamptz not null default now(),
  generated_by text,
  primary key (operator_id, section)
);

alter table public.eval_triage_reports enable row level security;

-- Reads: any authenticated user (the Report tab itself is gated to SuperAdmin in the UI).
-- Writes happen only through the eval-triage-report edge function using the service-role
-- key, which bypasses RLS — so no insert/update policy is needed here.
drop policy if exists "read eval triage reports" on public.eval_triage_reports;
create policy "read eval triage reports"
  on public.eval_triage_reports for select
  to authenticated
  using (true);
