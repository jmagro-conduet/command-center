-- "Ask the Operator" should stay strictly to KB/SOP/house-rules content, not
-- QA-agent training/testing material (test scenarios, response-accuracy
-- guidance, etc). Add an explicit per-article flag rather than inferring
-- this from the existing category taxonomy, which conflates the two
-- (e.g. "SOP: Spotting Response-Accuracy Issues" is tagged SOPs like real SOPs).

alter table public.kb_articles add column if not exists include_in_ask boolean not null default true;

update public.kb_articles set include_in_ask = false
where title in (
  'RSI UAT Testing Guide',
  'RSI Testing Playbook - Build your own Ticket',
  'SOP: Spotting Response-Accuracy Issues in Real Time'
);

create or replace function public.match_kb_chunks(
  query_embedding vector(1536), match_operator_id uuid, match_count int default 12
) returns table (chunk_id uuid, article_id uuid, article_title text, article_category text, content text, similarity float)
language sql stable as $$
  select c.id as chunk_id, c.article_id, a.title as article_title, a.category as article_category,
    c.content, 1 - (c.embedding <=> query_embedding) as similarity
  from public.kb_article_chunks c join public.kb_articles a on a.id = c.article_id
  where a.is_published = true and a.include_in_ask = true
    and (a.operator_id = match_operator_id or a.operator_id is null)
  order by c.embedding <=> query_embedding limit match_count;
$$;
