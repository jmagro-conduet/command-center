-- Upgrades the exact-text answer cache to also match semantically-similar
-- rephrasings of the same question, and adds a "commonly asked" aggregate
-- so the Ask UI can surface repeat questions per operator.

alter table public.ask_operator_cache add column if not exists embedding vector(1536);

create index if not exists ask_operator_cache_embedding_idx
  on public.ask_operator_cache using hnsw (embedding vector_cosine_ops);

-- Returns the closest cached answers for this operator, among cache rows
-- still within the caller's TTL window (min_created_at). Threshold filtering
-- deliberately lives in the caller (ask-operator), not here, so the match
-- quality can be tuned/observed by redeploying the function alone.
create or replace function public.match_cached_question(
  query_embedding vector(1536), match_operator_id uuid, min_created_at timestamptz, result_limit int default 5
) returns table (
  id uuid, question_key text, answer text, sources jsonb, coverage text, excluded_count int, similarity float
)
language sql stable as $$
  select c.id, c.question_key, c.answer, c.sources, c.coverage, c.excluded_count,
    1 - (c.embedding <=> query_embedding) as similarity
  from public.ask_operator_cache c
  where c.operator_id = match_operator_id
    and c.embedding is not null
    and c.created_at > min_created_at
  order by c.embedding <=> query_embedding
  limit result_limit;
$$;

-- Groups logged questions by normalized text (same normalization as the
-- cache key) so near-identical repeats surface as one entry. This is a
-- pragmatic v1 -- true paraphrases ("withdrawal options" vs "how do players
-- withdraw") won't cluster together here even though the semantic cache
-- above already serves them fast; only exact-ish repeats show as "common."
create or replace function public.common_asked_questions(
  match_operator_id uuid, since timestamptz, result_limit int default 8
) returns table (sample_question text, ask_count bigint)
language sql stable as $$
  select (array_agg(question order by created_at desc))[1] as sample_question, count(*) as ask_count
  from public.ask_operator_logs
  where operator_id = match_operator_id and created_at >= since
  group by lower(regexp_replace(trim(question), '\s+', ' ', 'g'))
  having count(*) > 1
  order by count(*) desc
  limit result_limit;
$$;
