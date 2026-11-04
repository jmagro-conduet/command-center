-- =============================================================================
-- Product Roadmap automation -- runs inside Command Center, no Claude routines.
--
--   roadmap_call()           helper: calls a roadmap edge function with the shared
--                            secret, which it reads from Supabase Vault at run time
--                            (the secret is never stored in this file or in cron.job)
--   roadmap_quarter_close()  snapshots the live roadmap on the last day of a quarter,
--                            then clears the sprint status for the new quarter
--   cron jobs                daily Linear sync, daily Slack news import, quarter close
--
-- Prerequisites (done once, outside this file):
--   * Vault secret named 'roadmap_ingest_secret' = the ROADMAP_INGEST_SECRET function secret
--   * edge functions roadmap-linear-sync and roadmap-news-sync deployed with --no-verify-jwt
--
-- Safe to re-run: functions use create or replace; cron.schedule() replaces a job
-- with the same name instead of duplicating it. Additive only: no existing table,
-- policy or cron job is touched.
-- =============================================================================

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- ---------- helper: call a roadmap edge function with the Vault secret ----------
create or replace function public.roadmap_call(p_fn text, p_body jsonb default '{}'::jsonb)
returns bigint
language plpgsql
security definer
set search_path = public, extensions, vault
as $$
declare
  v_secret text;
  v_id     bigint;
begin
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'roadmap_ingest_secret' limit 1;
  if v_secret is null then
    raise exception 'Vault secret roadmap_ingest_secret is not set';
  end if;
  select net.http_post(
    url     := 'https://uepigbagbaskbslpjeqq.supabase.co/functions/v1/' || p_fn,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-roadmap-secret', v_secret),
    body    := p_body,
    timeout_milliseconds := 150000
  ) into v_id;
  return v_id;
end;
$$;

revoke all on function public.roadmap_call(text, jsonb) from public, anon, authenticated;

-- ---------- helper: one collection as a JSON array of docs (with an id field) ----------
create or replace function public.roadmap_collection_json(p_collection text)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(data || jsonb_build_object('id', doc_id) order by doc_id), '[]'::jsonb)
  from public.roadmap_docs where collection = p_collection;
$$;

revoke all on function public.roadmap_collection_json(text) from public, anon, authenticated;

-- ---------- quarter close ----------
-- Acts only when "yesterday" (New York time) was the last day of a quarter. If that
-- quarter already has a final snapshot, it does nothing. After saving, it reads the
-- snapshot back and only then clears the sprint status. p_dry = true reports what it
-- would do without writing (used for testing).
create or replace function public.roadmap_quarter_close(p_now timestamptz default now(), p_dry boolean default false)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  d         date := ((p_now at time zone 'America/New_York')::date) - 1;
  qn        int;
  qid       text;
  qlabel    text;
  existing  jsonb;
  taken     text;
  snap      jsonb;
  n_linear  int;
  n_back    int;
begin
  if (d + 1) <> (date_trunc('quarter', (d + 1)::timestamp))::date then
    return 'skipped: ' || d || ' is not the last day of a quarter';
  end if;

  qn     := extract(quarter from d)::int;
  qid    := to_char(d, 'YYYY') || '-Q' || qn;
  qlabel := 'Q' || qn || ' ' || to_char(d, 'YYYY');

  select data into existing from public.roadmap_docs where collection = 'snapshots' and doc_id = qid;
  if existing is not null and existing ->> 'kind' = 'final' then
    return 'skipped: ' || qid || ' already has a final snapshot';
  end if;

  taken := to_char(p_now at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"');
  snap := jsonb_build_object(
    'quarter', qid, 'label', qlabel, 'kind', 'final', 'takenAt', taken, 'note', '',
    'data', jsonb_build_object(
      'linear',      public.roadmap_collection_json('linear'),
      'initiatives', public.roadmap_collection_json('initiatives'),
      'chunks',      public.roadmap_collection_json('chunks'),
      'overrides',   public.roadmap_collection_json('overrides'),
      'rice',        public.roadmap_collection_json('rice'),
      'items',       public.roadmap_collection_json('items'),
      'meta',     (select data from public.roadmap_docs where collection = 'meta' and doc_id = 'overview'),
      'planning', (select data from public.roadmap_docs where collection = 'meta' and doc_id = 'planning'),
      'sprint',   (select data from public.roadmap_docs where collection = 'meta' and doc_id = 'sprint'),
      'sync',     (select data from public.roadmap_docs where collection = 'sync' and doc_id = 'linear')
    )
  );
  n_linear := coalesce(jsonb_array_length(snap -> 'data' -> 'linear'), 0);

  if length(snap::text) > 3000000 then
    raise exception 'roadmap snapshot is larger than 3 MB; not saved';
  end if;
  if p_dry then
    return 'dry run: would save ' || qid || ' (' || n_linear || ' projects, ' || length(snap::text) || ' bytes) and clear the sprint status';
  end if;

  insert into public.roadmap_docs (collection, doc_id, data, updated_at, updated_by)
  values ('snapshots', qid, snap, now(), 'cron:quarter-close')
  on conflict (collection, doc_id) do update set data = excluded.data, updated_at = now(), updated_by = excluded.updated_by;

  select coalesce(jsonb_array_length(data -> 'data' -> 'linear'), 0) into n_back
  from public.roadmap_docs where collection = 'snapshots' and doc_id = qid;
  if n_back is distinct from n_linear then
    raise exception 'snapshot read-back mismatch (% vs %); sprint status NOT cleared', n_back, n_linear;
  end if;

  insert into public.roadmap_docs (collection, doc_id, data, updated_at, updated_by)
  values ('meta', 'sprint', jsonb_build_object('summary', '', 'focus', '[]'::jsonb, 'updatedAt', taken), now(), 'cron:quarter-close')
  on conflict (collection, doc_id) do update set data = excluded.data, updated_at = now(), updated_by = excluded.updated_by;

  return 'saved ' || qid || ' (' || n_linear || ' projects); sprint status cleared';
end;
$$;

revoke all on function public.roadmap_quarter_close(timestamptz, boolean) from public, anon, authenticated;

-- ---------- schedules (UTC) ----------
-- 10:41 UTC = 5:41am ET (winter) / 6:41am ET (summer)
select cron.schedule('roadmap-linear-sync-daily', '41 10 * * *',
  $$select public.roadmap_call('roadmap-linear-sync', '{"force": true}'::jsonb)$$);

-- 17:37 UTC = 12:37pm ET (winter) / 1:37pm ET (summer)
select cron.schedule('roadmap-news-sync-daily', '37 17 * * *',
  $$select public.roadmap_call('roadmap-news-sync', '{}'::jsonb)$$);

-- 06:30 UTC on the 1st of Jan/Apr/Jul/Oct = 1:30am-2:30am ET that day, i.e. just after the quarter ended
select cron.schedule('roadmap-quarter-close', '30 6 1 1,4,7,10 *',
  $$select public.roadmap_quarter_close()$$);
