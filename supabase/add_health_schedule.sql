-- ChangeFlow · make the System Health check schedule configurable from the Platform page.
--
-- The health-check Edge Function already runs server-side and records each run (with per-check
-- detail) to public.health_runs. This adds a pg_cron job whose INTERVAL can be changed by a Master
-- Admin from the UI, without ever exposing the cron secret to the browser.
--
-- PREREQUISITES (one time):
--   supabase secrets set HEALTH_CRON_SECRET=<random>
--   supabase functions deploy health-check --no-verify-jwt
--   -- then store the function URL + that secret once (values never leave the DB):
--   INSERT INTO public.health_cron_config (id, url, secret)
--   VALUES (true,
--           'https://wvhoyvtwdchkvxmkhezj.supabase.co/functions/v1/health-check',
--           'REPLACE_WITH_YOUR_HEALTH_CRON_SECRET')
--   ON CONFLICT (id) DO UPDATE SET url = EXCLUDED.url, secret = EXCLUDED.secret;
--
-- Safe to re-run.

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Single-row config holding the function URL + cron secret. RLS on with NO policies → the browser
-- can never read it; only the SECURITY DEFINER functions below (run as owner) can.
CREATE TABLE IF NOT EXISTS public.health_cron_config (
  id               boolean PRIMARY KEY DEFAULT true CHECK (id),
  url              text,
  secret           text,
  interval_minutes int,
  updated_at       timestamptz DEFAULT now()
);
ALTER TABLE public.health_cron_config ENABLE ROW LEVEL SECURITY;   -- no policies = no API access

-- Read the current schedule (interval + whether the cron job exists). Master-Admin only.
CREATE OR REPLACE FUNCTION public.get_health_schedule()
RETURNS TABLE (active boolean, interval_minutes int, cron text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'not authorized'; END IF;
  RETURN QUERY
    SELECT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'changeflow-health-check'),
           (SELECT hc.interval_minutes FROM public.health_cron_config hc WHERE hc.id),
           (SELECT j.schedule FROM cron.job j WHERE j.jobname = 'changeflow-health-check' LIMIT 1);
END $$;

-- Set the schedule to run every p_minutes (NULL/0 = turn off). Master-Admin only.
CREATE OR REPLACE FUNCTION public.set_health_schedule(p_minutes int)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_url text; v_secret text; v_cron text; v_cmd text;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'not authorized'; END IF;
  SELECT url, secret INTO v_url, v_secret FROM public.health_cron_config WHERE id;
  IF v_url IS NULL OR v_secret IS NULL THEN
    RAISE EXCEPTION 'health_cron_config not set — insert the function URL + secret first';
  END IF;

  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'changeflow-health-check') THEN
    PERFORM cron.unschedule('changeflow-health-check');
  END IF;

  IF p_minutes IS NULL OR p_minutes <= 0 THEN
    UPDATE public.health_cron_config SET interval_minutes = NULL, updated_at = now() WHERE id;
    RETURN 'schedule disabled';
  END IF;

  v_cron := CASE
    WHEN p_minutes < 60             THEN '*/' || p_minutes || ' * * * *'
    WHEN p_minutes % 60 = 0
     AND p_minutes < 1440           THEN '0 */' || (p_minutes / 60) || ' * * *'
    ELSE '0 3 * * *'                -- daily fallback
  END;

  v_cmd := format(
    $f$SELECT net.http_post(url := %L,
        headers := jsonb_build_object('Content-Type','application/json','x-cron-secret', %L),
        body := jsonb_build_object('source','scheduled'));$f$,
    v_url, v_secret);

  PERFORM cron.schedule('changeflow-health-check', v_cron, v_cmd);
  UPDATE public.health_cron_config SET interval_minutes = p_minutes, updated_at = now() WHERE id;
  RETURN 'scheduled: ' || v_cron;
END $$;

GRANT EXECUTE ON FUNCTION public.get_health_schedule()      TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_health_schedule(int)   TO authenticated;

SELECT 'health schedule config + RPCs created' AS result;
