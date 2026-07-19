-- ChangeFlow · daily progress snapshots, so CORA can show TREND and VELOCITY rather than only
-- "where we are today".
--
-- Everything else in the platform is point-in-time: 42% complete, readiness Amber. Sponsors ask a
-- different question — "are we improving, and will we make the date?" That needs history, so this
-- captures one row per project per day. Computed entirely in Postgres (no edge function needed).
-- Safe to re-run; re-running on the same day updates that day's row rather than duplicating.

CREATE EXTENSION IF NOT EXISTS pg_cron;

CREATE TABLE IF NOT EXISTS public.progress_snapshots (
  id          uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  captured_on date NOT NULL DEFAULT current_date,
  client_id   uuid REFERENCES public.clients(id)  ON DELETE CASCADE,
  project_id  uuid REFERENCES public.projects(id) ON DELETE CASCADE,
  members     int,
  total       int,          -- pathway steps x members (the denominator)
  done        int,          -- completed activities
  pct         int,
  overdue     int,
  created_at  timestamptz DEFAULT now(),
  UNIQUE (captured_on, project_id)
);
CREATE INDEX IF NOT EXISTS progress_snap_proj_idx ON public.progress_snapshots (project_id, captured_on);

ALTER TABLE public.progress_snapshots ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "read progress snapshots" ON public.progress_snapshots;
CREATE POLICY "read progress snapshots" ON public.progress_snapshots FOR SELECT
  USING (public.is_admin() OR client_id = public.my_client_id());
GRANT SELECT ON public.progress_snapshots TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.progress_snapshots TO service_role;

-- Capture today's position for every project. Idempotent per day.
CREATE OR REPLACE FUNCTION public.snapshot_progress()
RETURNS int
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE n int;
BEGIN
  WITH mem AS (
    SELECT project_id, count(*)::int AS members FROM public.project_members GROUP BY 1
  ),
  steps AS (
    SELECT project_id, count(*)::int AS steps FROM public.project_pathways GROUP BY 1
  ),
  dn AS (
    SELECT w.project_id, count(*)::int AS done
    FROM public.user_activities ua
    JOIN public.project_pathways w  ON w.content_id = ua.content_id
    JOIN public.project_members  pm ON pm.project_id = w.project_id AND pm.user_id = ua.user_id
    WHERE ua.status = 'completed'
    GROUP BY 1
  ),
  od AS (
    SELECT project_id, count(*)::int AS overdue
    FROM public.project_phases
    WHERE planned_end IS NOT NULL AND planned_end < current_date
      AND coalesce(status, '') <> 'completed'
    GROUP BY 1
  )
  INSERT INTO public.progress_snapshots (captured_on, client_id, project_id, members, total, done, pct, overdue)
  SELECT current_date, p.client_id, p.id,
         coalesce(mem.members, 0),
         coalesce(mem.members, 0) * coalesce(steps.steps, 0),
         coalesce(dn.done, 0),
         CASE WHEN coalesce(mem.members, 0) * coalesce(steps.steps, 0) > 0
              THEN round(100.0 * coalesce(dn.done, 0) / (mem.members * steps.steps))::int
              ELSE 0 END,
         coalesce(od.overdue, 0)
  FROM public.projects p
  LEFT JOIN mem   ON mem.project_id   = p.id
  LEFT JOIN steps ON steps.project_id = p.id
  LEFT JOIN dn    ON dn.project_id    = p.id
  LEFT JOIN od    ON od.project_id    = p.id
  ON CONFLICT (captured_on, project_id) DO UPDATE
    SET members = EXCLUDED.members, total = EXCLUDED.total, done = EXCLUDED.done,
        pct = EXCLUDED.pct, overdue = EXCLUDED.overdue;

  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;

GRANT EXECUTE ON FUNCTION public.snapshot_progress() TO authenticated;

-- Daily at 02:00 UTC. Pure SQL, so no function deploy or secret is involved.
DO $$
BEGIN
  PERFORM cron.unschedule('changeflow-progress-snapshot');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

SELECT cron.schedule('changeflow-progress-snapshot', '0 2 * * *', 'SELECT public.snapshot_progress()');

-- Seed today's row immediately so the trend has a starting point.
SELECT public.snapshot_progress() AS projects_snapshotted;
