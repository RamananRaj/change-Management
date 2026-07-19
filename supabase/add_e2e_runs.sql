-- ChangeFlow · E2E (Playwright) run history, surfaced in System Admin → E2E Tests.
-- A row is written by the e2e-report Edge Function (service role) after each Playwright run,
-- typically from CI. Master Admins read the history. Mirrors health_runs. Safe to re-run.

CREATE TABLE IF NOT EXISTS public.e2e_runs (
  id          uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  ran_at      timestamptz DEFAULT now(),
  source      text DEFAULT 'ci',           -- 'ci' | 'local'
  total       int,
  passed      int,
  failed      int,
  skipped     int,
  duration_ms int,
  specs       jsonb,                        -- [{ title, file, status, duration_ms, error }]
  commit      text,
  branch      text
);
CREATE INDEX IF NOT EXISTS e2e_runs_ran_idx ON public.e2e_runs (ran_at DESC);

ALTER TABLE public.e2e_runs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Admins read e2e runs" ON public.e2e_runs;
CREATE POLICY "Admins read e2e runs" ON public.e2e_runs FOR SELECT USING (public.is_admin());
GRANT SELECT ON public.e2e_runs TO authenticated;
GRANT INSERT, SELECT ON public.e2e_runs TO service_role;   -- the report function writes with service role

SELECT 'e2e_runs table created' AS result;
