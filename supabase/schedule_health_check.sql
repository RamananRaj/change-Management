-- ChangeFlow: schedule the health-check Edge Function every 15 minutes via pg_cron.
--
-- PREREQUISITES (run once, and set the secret + deploy the function first):
--   supabase secrets set HEALTH_CRON_SECRET=<your-random-secret>
--   supabase functions deploy health-check --no-verify-jwt
--
-- Then EDIT the two placeholders below (secret) and run this in the SQL editor.

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Remove any previous schedule with this name, then (re)create it.
SELECT cron.unschedule('changeflow-health-check')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'changeflow-health-check');

SELECT cron.schedule(
  'changeflow-health-check',
  '*/15 * * * *',                      -- every 15 minutes
  $$
  SELECT net.http_post(
    url     := 'https://wvhoyvtwdchkvxmkhezj.supabase.co/functions/v1/health-check',
    headers := jsonb_build_object(
                 'Content-Type', 'application/json',
                 'x-cron-secret', 'REPLACE_WITH_YOUR_HEALTH_CRON_SECRET'
               ),
    body    := jsonb_build_object('source', 'scheduled')
  );
  $$
);

SELECT 'health-check scheduled every 15 min' AS result;
