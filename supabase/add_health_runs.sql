-- ChangeFlow: System Health run history + scheduled auto-runs.
-- A row is written by the health-check Edge Function (server-side), either on a schedule
-- or from a manual admin run. Master Admins can read the history. Safe to re-run.

CREATE TABLE IF NOT EXISTS public.health_runs (
  id       uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  ran_at   timestamptz DEFAULT now(),
  source   text DEFAULT 'scheduled' CHECK (source IN ('scheduled','manual')),
  total    int,
  passed   int,
  failed   int,
  checks   jsonb,
  duration_ms int
);

ALTER TABLE public.health_runs ENABLE ROW LEVEL SECURITY;

-- Master Admins read history; inserts happen via the Edge Function (service role, bypasses RLS).
DROP POLICY IF EXISTS "Admins read health runs" ON public.health_runs;
CREATE POLICY "Admins read health runs" ON public.health_runs FOR SELECT USING (public.is_admin());

GRANT SELECT ON public.health_runs TO authenticated;

SELECT 'health_runs table created' AS result;
