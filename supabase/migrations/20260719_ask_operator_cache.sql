-- Ask the Operator is about to go from occasional/on-demand to team-wide
-- usage. A QA team covering the same operator asks a lot of overlapping
-- questions ("what are the withdrawal options" phrased five different
-- ways over a shift) — cache the answer per (operator, normalized question)
-- so repeats skip the embed+retrieve+Claude round trip entirely.

create table if not exists public.ask_operator_cache (
  id uuid primary key default gen_random_uuid(),
  operator_id uuid not null references public.operators(id),
  question_key text not null,
  answer text not null,
  sources jsonb not null default '[]',
  coverage text not null,
  excluded_count int not null default 0,
  created_at timestamptz not null default now()
);

create unique index if not exists ask_operator_cache_operator_question_idx
  on public.ask_operator_cache (operator_id, question_key);

alter table public.ask_operator_cache enable row level security;

create policy authenticated_manage_ask_operator_cache
  on public.ask_operator_cache for all to authenticated using (true);
