-- ChangeFlow · AI-usage retention so the raw log can't grow unbounded.
-- The System Admin tab shows the last 7 days live and older rows on demand ("History"), but the
-- raw ai_usage table is the only thing that grows with every query. This caps it: a nightly
-- pg_cron job deletes rows older than the retention horizon. Per-client/project aggregates keep
-- working within that window. Safe to re-run.
--
-- Horizon: 180 days. Change the interval below if you want a longer/shorter window.

-- created_at index already exists (ai_usage_created_idx) and makes the delete cheap.

-- (Re)create the nightly job idempotently.
DO $$
BEGIN
  PERFORM cron.unschedule('ai_usage_retention');
EXCEPTION WHEN OTHERS THEN
  NULL;   -- not scheduled yet
END $$;

SELECT cron.schedule(
  'ai_usage_retention',
  '30 3 * * *',   -- 03:30 daily
  $$ DELETE FROM public.ai_usage WHERE created_at < now() - interval '180 days' $$
);

SELECT 'ai_usage retention scheduled (180 days)' AS result;
