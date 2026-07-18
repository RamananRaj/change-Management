-- ChangeFlow · schedule-based phase auto-unlock.
-- Phases open by their planned_start date instead of manual toggling: any phase still 'locked'
-- whose planned_start has arrived becomes 'active'. Runs daily via pg_cron, and once now.
-- Completion stays progress-driven (not touched here). Safe to re-run.

CREATE OR REPLACE FUNCTION public.auto_unlock_phases()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE n integer;
BEGIN
  UPDATE public.project_phases
     SET status = 'active'
   WHERE status = 'locked'
     AND planned_start IS NOT NULL
     AND planned_start <= CURRENT_DATE;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$$;

-- Schedule it daily at 01:00 (needs pg_cron; already used for the health check).
CREATE EXTENSION IF NOT EXISTS pg_cron;
SELECT cron.unschedule('auto-unlock-phases-daily')
  WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'auto-unlock-phases-daily');
SELECT cron.schedule('auto-unlock-phases-daily', '0 1 * * *', $$ SELECT public.auto_unlock_phases(); $$);

-- Catch up any phases already due, right now.
SELECT public.auto_unlock_phases() AS phases_unlocked_now;

-- Note: an admin can still re-lock a phase in Phase Manager, but if its planned_start is in the
-- past the next daily run will re-open it. Clear the phase's start date to keep it locked.
