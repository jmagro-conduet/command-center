-- Auto-eval trigger: run the eval flows server-side whenever new ticket_issues
-- are inserted, so scoring never depends on a browser tab staying open.
--
-- Statement-level. Fires ONLY for manual Command Center submissions:
--   * Manual submissions (source = 'manual') are sent to the `auto-eval` edge
--     function immediately, so they score without a browser staying open.
--   * Bulk imports (source = 'bolt_import' / 'metabase_import') are SKIPPED here.
--     A Metabase upload inserts ticket-by-ticket, so a naive trigger would fire
--     dozens–hundreds of times and hammer the Anthropic API. Imports must run
--     the batched backfill instead (Settings → backfill, or backfill.ps1), which
--     chunks the work 25/50/10 to stay under rate limits.
--   * A secondary 25-row size guard catches any unexpectedly large manual insert.
--
-- (Depends on the `source` column from 20260619_issue_level_columns.sql.)
--
-- NOTE: if you instead create the webhook via the dashboard, do NOT apply this
-- migration too — you'd double-fire and double-score.

create extension if not exists pg_net;

create or replace function public.handle_new_ticket_issues()
returns trigger
language plpgsql
security definer
as $$
declare
  v_ids   text[];
  v_count int;
begin
  -- Only manual submissions auto-eval; imports go through the batched backfill.
  select array_agg(id::text), count(*)
    into v_ids, v_count
  from new_rows
  where coalesce(source, 'manual') = 'manual';

  -- Skip if nothing manual, or an unexpectedly large manual insert (see header).
  if v_count = 0 or v_count > 25 then
    return null;
  end if;

  perform net.http_post(
    url     := 'https://uepigbagbaskbslpjeqq.supabase.co/functions/v1/auto-eval',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      -- public anon key — safe to embed; satisfies the function gateway only
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVlcGlnYmFnYmFza2JzbHBqZXFxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ5MTU4MjksImV4cCI6MjA5MDQ5MTgyOX0.hz75aFhXeL5yRkbwn1tmHd37D2omQ3wR8LbOG6pJpzI'
    ),
    body    := jsonb_build_object('ids', to_jsonb(v_ids))
  );

  return null;
end;
$$;

drop trigger if exists trg_auto_eval_on_issue on public.ticket_issues;

create trigger trg_auto_eval_on_issue
  after insert on public.ticket_issues
  referencing new table as new_rows
  for each statement
  execute function public.handle_new_ticket_issues();
