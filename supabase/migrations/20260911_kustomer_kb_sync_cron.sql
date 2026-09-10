-- Recurring sync: re-pulls Modo's Kustomer Knowledge Base into Learn on a
-- monthly cadence, so edits/new SOPs made in Kustomer keep flowing in
-- automatically without needing a manual re-run. Monthly is enough given how
-- rarely these actually change -- and kustomer-kb-sync only re-embeds
-- articles whose Kustomer version timestamp actually changed since the last
-- run, so even a tighter cadence would cost nothing extra on weeks where
-- nothing changed. Same net.http_post pattern already used by the auto-eval
-- trigger (20260620_auto_eval_trigger.sql), just on a cron schedule instead
-- of a row trigger.
--
-- Re-running this migration is safe -- cron.schedule() with an existing job
-- name replaces that job's schedule/command rather than creating a duplicate,
-- so tweaking the cadence later is just editing the schedule string below
-- and re-running.

create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.schedule(
  'kustomer-kb-sync-monthly',
  '0 13 1 * *', -- 1pm UTC on the 1st of each month
  $$
  select net.http_post(
    url     := 'https://uepigbagbaskbslpjeqq.supabase.co/functions/v1/kustomer-kb-sync',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      -- public anon key -- safe to embed; satisfies the function gateway only
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVlcGlnYmFnYmFza2JzbHBqZXFxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ5MTU4MjksImV4cCI6MjA5MDQ5MTgyOX0.hz75aFhXeL5yRkbwn1tmHd37D2omQ3wR8LbOG6pJpzI'
    ),
    body    := '{}'::jsonb
  );
  $$
);
