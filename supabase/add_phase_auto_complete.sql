-- ChangeFlow: a phase closes when the work under it is finished — not when someone says so.
--
-- WHAT WAS MISSING
--   Nothing in the platform ever set project_phases.status = 'completed'. The only route
--   was an admin clicking through the locked → active → done cycler by hand, which meant
--   a phase could be marked finished with every exercise still outstanding, and a phase
--   with all its work genuinely done stayed 'active' until somebody remembered to click.
--
--   Both directions were wrong. The status said whatever the last person to click said.
--
-- THE RULE
--   An active, in-scope phase completes when every exercise in its pathway has been
--   completed by every member assigned to the project. Completion is earned by finishing
--   the work, and the platform observes it rather than being told.
--
-- THREE THINGS THIS DELIBERATELY WILL NOT DO
--   1. A phase with NO pathway items never completes. Nothing has been asked of anyone,
--      so there is nothing to have finished — that is an empty phase, not a done one.
--      (min() over zero rows is NULL, so the HAVING guards this explicitly.)
--   2. It never re-opens a completed phase. If a member is added later the phase would
--      drop below 100%, and un-completing finished work would rewrite history.
--   3. It only counts members currently assigned to the project. Completions by someone
--      who has left should not hold a phase open, and should not close it either.
--
-- Safe to re-run.

CREATE OR REPLACE FUNCTION public.auto_complete_phases()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE n integer;
BEGIN
  WITH seats AS (
    SELECT project_id, count(DISTINCT user_id) AS n
    FROM public.project_members
    GROUP BY project_id
  ),
  ex AS (
    -- One row per exercise, carrying how many ASSIGNED members have completed it.
    SELECT pw.project_id, pw.phase_number, pw.content_id,
           count(DISTINCT ua.user_id) AS done_by
    FROM public.project_pathways pw
    LEFT JOIN public.project_members pm ON pm.project_id = pw.project_id
    LEFT JOIN public.user_activities ua
           ON ua.content_id = pw.content_id
          AND ua.user_id    = pm.user_id
          AND ua.status     = 'completed'
    GROUP BY pw.project_id, pw.phase_number, pw.content_id
  ),
  finished AS (
    SELECT e.project_id, e.phase_number
    FROM ex e
    JOIN seats s ON s.project_id = e.project_id
    GROUP BY e.project_id, e.phase_number, s.n
    -- count(*) > 0 : the phase actually has exercises.
    -- min(done_by) >= s.n : the LEAST-completed exercise is still done by everyone,
    --                       which is the only way to say "all of it, by all of them".
    HAVING count(*) > 0 AND min(e.done_by) >= s.n
  )
  UPDATE public.project_phases ph
     SET status = 'completed'
    FROM finished f
   WHERE ph.project_id   = f.project_id
     AND ph.phase_number = f.phase_number
     AND ph.status       = 'active'          -- never re-open, never skip locked
     AND ph.lane_id IS NOT NULL;             -- scope: not work we are running
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$$;

-- Runs just after the unlock job, so a phase can open and — if the work is already
-- done — close in the same nightly pass rather than waiting another day.
CREATE EXTENSION IF NOT EXISTS pg_cron;
SELECT cron.unschedule('auto-complete-phases-daily')
  WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'auto-complete-phases-daily');
SELECT cron.schedule('auto-complete-phases-daily', '5 1 * * *',
                     $$ SELECT public.auto_complete_phases(); $$);

-- ─────────────────────────────────────────────────────────────
-- Preview before it runs
-- ─────────────────────────────────────────────────────────────
-- Which active phases are fully done, and which are not, with the shortfall named.
-- Read this BEFORE the catch-up call below, so nothing changes state unexamined.
WITH seats AS (
  SELECT project_id, count(DISTINCT user_id) AS n FROM public.project_members GROUP BY project_id
),
ex AS (
  SELECT pw.project_id, pw.phase_number, pw.content_id,
         count(DISTINCT ua.user_id) AS done_by
  FROM public.project_pathways pw
  LEFT JOIN public.project_members pm ON pm.project_id = pw.project_id
  LEFT JOIN public.user_activities ua
         ON ua.content_id = pw.content_id AND ua.user_id = pm.user_id AND ua.status = 'completed'
  GROUP BY pw.project_id, pw.phase_number, pw.content_id
)
SELECT p.name AS project, ph.phase_number, ph.status,
       count(e.content_id)                        AS exercises,
       coalesce(min(e.done_by), 0)                AS least_completed_by,
       max(s.n)                                   AS members,
       CASE
         WHEN count(e.content_id) = 0        THEN 'no exercises — cannot complete'
         WHEN min(e.done_by) >= max(s.n)     THEN 'FULLY DONE — will complete'
         ELSE 'outstanding work remains'
       END AS verdict
FROM public.project_phases ph
JOIN public.projects p ON p.id = ph.project_id
LEFT JOIN ex e ON e.project_id = ph.project_id AND e.phase_number = ph.phase_number
LEFT JOIN seats s ON s.project_id = ph.project_id
WHERE ph.lane_id IS NOT NULL AND ph.status = 'active'
GROUP BY p.name, ph.phase_number, ph.status
ORDER BY p.name, ph.phase_number;

-- Catch up now. Run this only after reading the preview above.
SELECT public.auto_complete_phases() AS phases_completed_now;
