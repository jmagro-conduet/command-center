-- Move eval_triage_reports from "one row per operator+section" (overwritten on every
-- regenerate) to an append-only history, and add a window_mode dimension so each data
-- window (latest-delta / trailing 90 days / all-time) keeps its own independent timeline.
-- Existing rows default to window_mode='all' (they were generated against full history,
-- which is accurate for that label) — additive, no data loss.
alter table public.eval_triage_reports add column if not exists id uuid not null default gen_random_uuid();
alter table public.eval_triage_reports add column if not exists window_mode text not null default 'all';

alter table public.eval_triage_reports drop constraint if exists eval_triage_reports_pkey;
alter table public.eval_triage_reports add constraint eval_triage_reports_pkey primary key (id);

create index if not exists idx_eval_triage_reports_lookup
  on public.eval_triage_reports (operator_id, section, window_mode, generated_at desc);
