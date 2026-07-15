-- Semantic search for Learn KB content, replacing the "stuff the whole
-- operator's corpus into context" approach in ask-operator. That approach hit
-- a real limit immediately: RSI alone has 8 PDF SOPs, exceeding Anthropic's
-- 600-combined-PDF-page cap per request. Chunking + embeddings means each
-- query only sends the handful of genuinely relevant chunks, not everything.
create extension if not exists vector;

create table if not exists public.kb_article_chunks (
  id          uuid primary key default gen_random_uuid(),
  article_id  uuid not null references public.kb_articles(id) on delete cascade,
  chunk_index int not null,
  content     text not null,
  embedding   vector(1536) not null, -- OpenAI text-embedding-3-small
  created_at  timestamptz not null default now()
);

create index if not exists kb_article_chunks_article_idx on public.kb_article_chunks (article_id);
create index if not exists kb_article_chunks_embedding_idx on public.kb_article_chunks
  using hnsw (embedding vector_cosine_ops);

alter table public.kb_article_chunks enable row level security;

create policy "authenticated_manage_kb_article_chunks"
  on public.kb_article_chunks
  for all to authenticated
  using (true) with check (true);

-- Tracks indexing status per article so ask-operator can honestly report how
-- many published articles for an operator aren't searchable yet (never
-- indexed, or indexing skipped/failed -- e.g. a DOCX/XLSX/PPTX-only upload).
alter table public.kb_articles add column if not exists indexed_at timestamptz;
alter table public.kb_articles add column if not exists index_skip_reason text;

-- Cosine-similarity search, scoped to one operator's published articles plus
-- global (operator_id null) ones -- same visibility rule Learn.tsx already uses.
create or replace function public.match_kb_chunks(
  query_embedding vector(1536),
  match_operator_id uuid,
  match_count int default 12
)
returns table (
  chunk_id         uuid,
  article_id       uuid,
  article_title    text,
  article_category text,
  content          text,
  similarity       float
)
language sql stable
as $$
  select
    c.id as chunk_id,
    c.article_id,
    a.title as article_title,
    a.category as article_category,
    c.content,
    1 - (c.embedding <=> query_embedding) as similarity
  from public.kb_article_chunks c
  join public.kb_articles a on a.id = c.article_id
  where a.is_published = true
    and (a.operator_id = match_operator_id or a.operator_id is null)
  order by c.embedding <=> query_embedding
  limit match_count;
$$;
