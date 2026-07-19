-- ChangeFlow · admin-controlled E2E scheduling.
-- Master Admin sets how often the Playwright suite runs, from System Admin → E2E Tests. pg_cron
-- pings the e2e-trigger function, which dispatches the GitHub workflow; results come back via
-- e2e-report into e2e_runs. Mirrors the health-check schedule pattern. Safe to re-run.

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Private config: trigger-function URL + secret. RLS on, no policies → never readable by the browser.
CREATE TABLE IF NOT EXISTS public.e2e_cron_config (
  id               boolean PRIMARY KEY DEFAULT true CHECK (id),
  url              text,
  secret           text,
  interval_minutes int,
  updated_at       timestamptz DEFAULT now()
);
ALTER TABLE public.e2e_cron_config ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.get_e2e_schedule()
RETURNS TABLE (active boolean, interval_minutes int, cron text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'not authorized'; END IF;
  RETURN QUERY
    SELECT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'changeflow-e2e'),
           (SELECT c.interval_minutes FROM public.e2e_cron_config c WHERE c.id),
           (SELECT j.schedule FROM cron.job j WHERE j.jobname = 'changeflow-e2e' LIMIT 1);
END $$;

-- p_minutes NULL/0 = off. Typical: 360 (6h), 720 (12h), 1440 (daily).
CREATE OR REPLACE FUNCTION public.set_e2e_schedule(p_minutes int)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_url text; v_secret text; v_cron text; v_cmd text;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'not authorized'; END IF;
  SELECT url, secret INTO v_url, v_secret FROM public.e2e_cron_config WHERE id;
  IF v_url IS NULL OR v_secret IS NULL THEN RAISE EXCEPTION 'e2e_cron_config not set — insert the URL + secret first'; END IF;

  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'changeflow-e2e') THEN PERFORM cron.unschedule('changeflow-e2e'); END IF;

  IF p_minutes IS NULL OR p_minutes <= 0 THEN
    UPDATE public.e2e_cron_config SET interval_minutes = NULL, updated_at = now() WHERE id;
    RETURN 'E2E schedule disabled';
  END IF;

  v_cron := CASE
    WHEN p_minutes < 60                             THEN '*/' || p_minutes || ' * * * *'
    WHEN p_minutes % 60 = 0 AND p_minutes < 1440    THEN '0 */' || (p_minutes / 60) || ' * * *'
    ELSE '0 6 * * *'                                -- daily 06:00
  END;

  v_cmd := format($f$SELECT net.http_post(url := %L,
             headers := jsonb_build_object('Content-Type','application/json','x-cron-secret', %L),
             body := jsonb_build_object('source','scheduled'));$f$, v_url, v_secret);

  PERFORM cron.schedule('changeflow-e2e', v_cron, v_cmd);
  UPDATE public.e2e_cron_config SET interval_minutes = p_minutes, updated_at = now() WHERE id;
  RETURN 'E2E scheduled: ' || v_cron;
END $$;

GRANT EXECUTE ON FUNCTION public.get_e2e_schedule()    TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_e2e_schedule(int) TO authenticated;

SELECT 'e2e schedule config + RPCs created' AS result;
