-- Manual data-entry backing for the Executive Summary "Full Auto" preview tab.
-- Zendesk investigation found no reliable, ready-to-wire source for Automation
-- Rate or Handle Rate (Total Tickets / Resolution Time / Escalation Rate do
-- have real ZD data, but sourcing them live is deferred until the full-auto
-- pilot's own gamelm_full_auto_* tag semantics are confirmed) -- so v1 ships
-- as a fully manual snapshot an admin enters over time, one row per date.

create table if not exists public.operator_automation_snapshots (
  id uuid primary key default gen_random_uuid(),
  operator_id uuid not null references public.operators(id) on delete cascade,
  snapshot_date date not null,
  total_tickets integer,
  automation_rate numeric,
  escalation_rate numeric,
  resolution_time_minutes numeric,
  handle_rate numeric,
  created_by_email text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (operator_id, snapshot_date)
);

alter table public.operator_automation_snapshots enable row level security;

create policy authenticated_manage_operator_automation_snapshots
  on public.operator_automation_snapshots for all to authenticated using (true);

-- Per-operator switch for whether the Full Auto tab shows on Executive
-- Summary at all -- phased rollout, only turned on for operators actually
-- being migrated toward the production Full Auto dashboard.
alter table public.operators add column if not exists full_auto_enabled boolean not null default false;
