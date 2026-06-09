-- Add operator_id to kb_articles for per-operator knowledge base scoping

alter table public.kb_articles
  add column if not exists operator_id uuid references public.operators(id);

create index if not exists kb_articles_operator_id_idx on public.kb_articles (operator_id);
