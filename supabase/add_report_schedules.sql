-- ChangeFlow · scheduled native Word reports.
-- Master Admin configures schedules (client, optional project, cadence + day). An hourly pg_cron
-- job pings the report-generate Edge Function, which builds a true .docx server-side, stores it in
-- the private `reports` bucket and records it in report_files. Dispatch (email etc.) can be layered
-- on later — generation and storage are decoupled from delivery. Safe to re-run.

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- ── Schedules ──────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.report_schedules (
  id            uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id     uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  project_id    uuid REFERENCES public.projects(id) ON DELETE CASCADE,   -- NULL = whole client
  cadence       text NOT NULL DEFAULT 'monthly' CHECK (cadence IN ('weekly','fortnightly','monthly')),
  day_of_week   int  DEFAULT 1 CHECK (day_of_week BETWEEN 0 AND 6),      -- 0=Sun (weekly/fortnightly)
  day_of_month  int  DEFAULT 1 CHECK (day_of_month BETWEEN 1 AND 28),    -- monthly
  hour          int  NOT NULL DEFAULT 6 CHECK (hour BETWEEN 0 AND 23),   -- UTC hour to generate
  enabled       boolean NOT NULL DEFAULT true,
  last_run_at   timestamptz,
  created_at    timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS report_sched_client_idx ON public.report_schedules (client_id);

ALTER TABLE public.report_schedules ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "admins manage report schedules" ON public.report_schedules;
CREATE POLICY "admins manage report schedules" ON public.report_schedules
  USING (public.is_admin()) WITH CHECK (public.is_admin());
GRANT SELECT, INSERT, UPDATE, DELETE ON public.report_schedules TO authenticated;
GRANT SELECT, UPDATE ON public.report_schedules TO service_role;

-- ── Generated files ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.report_files (
  id           uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  schedule_id  uuid REFERENCES public.report_schedules(id) ON DELETE SET NULL,
  client_id    uuid REFERENCES public.clients(id) ON DELETE CASCADE,
  project_id   uuid REFERENCES public.projects(id) ON DELETE SET NULL,
  title        text,
  filename     text,
  path         text,                       -- storage object path within the `reports` bucket
  size_bytes   int,
  format       text DEFAULT 'docx',
  source       text DEFAULT 'scheduled' CHECK (source IN ('scheduled','manual')),
  generated_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS report_files_gen_idx ON public.report_files (generated_at DESC);

ALTER TABLE public.report_files ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "read report files" ON public.report_files;
CREATE POLICY "read report files" ON public.report_files FOR SELECT
  USING (public.is_admin() OR client_id = public.my_client_id());
GRANT SELECT ON public.report_files TO authenticated;
GRANT SELECT, INSERT ON public.report_files TO service_role;

-- ── Private storage bucket for the generated documents ─────────────────────────────
INSERT INTO storage.buckets (id, name, public)
VALUES ('reports', 'reports', false)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "admins read report objects" ON storage.objects;
CREATE POLICY "admins read report objects" ON storage.objects FOR SELECT
  USING (bucket_id = 'reports' AND public.is_admin());

-- ── Private cron config + hourly trigger ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.report_cron_config (
  id     boolean PRIMARY KEY DEFAULT true CHECK (id),
  url    text,
  secret text
);
ALTER TABLE public.report_cron_config ENABLE ROW LEVEL SECURITY;   -- no policies = no API access

-- Runs hourly; the function itself decides which schedules are due (cadence + day + hour).
CREATE OR REPLACE FUNCTION public.set_report_cron(p_enabled boolean DEFAULT true)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_url text; v_secret text; v_cmd text;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'not authorized'; END IF;
  SELECT url, secret INTO v_url, v_secret FROM public.report_cron_config WHERE id;
  IF v_url IS NULL OR v_secret IS NULL THEN RAISE EXCEPTION 'report_cron_config not set — insert the URL + secret first'; END IF;

  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'changeflow-reports') THEN PERFORM cron.unschedule('changeflow-reports'); END IF;
  IF NOT p_enabled THEN RETURN 'report generation cron disabled'; END IF;

  v_cmd := format($f$SELECT net.http_post(url := %L,
             headers := jsonb_build_object('Content-Type','application/json','x-cron-secret', %L),
             body := jsonb_build_object('source','scheduled'));$f$, v_url, v_secret);
  PERFORM cron.schedule('changeflow-reports', '5 * * * *', v_cmd);   -- five past every hour
  RETURN 'report generation scheduled hourly';
END $$;
GRANT EXECUTE ON FUNCTION public.set_report_cron(boolean) TO authenticated;

SELECT 'report schedules + files + bucket created' AS result;
