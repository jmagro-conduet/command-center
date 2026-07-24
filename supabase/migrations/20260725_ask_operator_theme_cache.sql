-- Backs the "Commonly asked" panel once it moved from exact-text grouping
-- (undercounted real repeats phrased differently) to LLM-based semantic
-- clustering. Cached per operator so opening Ask repeatedly doesn't re-run
-- the clustering call every time.

create table if not exists public.ask_operator_theme_cache (
  operator_id uuid primary key references public.operators(id),
  themes jsonb not null,
  computed_at timestamptz not null default now()
);

alter table public.ask_operator_theme_cache enable row level security;

create policy authenticated_manage_ask_operator_theme_cache
  on public.ask_operator_theme_cache for all to authenticated using (true);

-- Superseded by the summarize-common-questions edge function.
drop function if exists public.common_asked_questions(uuid, timestamptz, int);
