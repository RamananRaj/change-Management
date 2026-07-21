-- ChangeFlow: the admin decides when a phase opens.
--
-- THE PROBLEM THIS SOLVES
--   Two mechanisms currently decide whether a phase is open, and they fight.
--
--   The admin can cycle a phase locked → active → done by hand. The nightly job opens any
--   locked phase whose planned_start has arrived. So an admin who deliberately re-locks a
--   phase finds it open again the next morning, with nothing on screen to explain why.
--
--   The original migration knew this and documented a workaround: "clear the phase's
--   start date to keep it locked". That means destroying real plan data in order to
--   express an intent — and the timeline then draws the phase with no dates, so the
--   workaround corrupts the chart to fix the gate.
--
-- WHY A NEW COLUMN RATHER THAN MORE STATUS VALUES
--   `status` answers "where is this phase" — locked, active, completed. The admin's
--   decision is a different fact: "how should this phase open at all". Smuggling the
--   second into the first is exactly why the cron kept overwriting it; the job cannot
--   tell a phase that is locked because its date has not arrived from one that is locked
--   because a human decided so.
--
--   Separating them means the job can respect an intent it did not set.
--
-- THE THREE MODES
--   'plan'  — default. Opens on planned_start, as today. The schedule is the authority.
--   'open'  — the admin opened it ahead of the plan. Dates are left untouched, so the
--             timeline still shows when the work was MEANT to start; only the gate moved.
--   'hold'  — stays closed even though the date has passed. The job leaves it alone.
--
-- WHAT DELIBERATELY DOES NOT HAPPEN
--   Setting a phase back to 'plan' does not re-close it. Opening a phase is a decision
--   people act on — they are working in it. Silently shutting a phase because an admin
--   changed a dropdown would take work away from someone mid-task. 'hold' is the
--   explicit way to close something, so closing is always a deliberate act.
--
-- Safe to re-run.

ALTER TABLE public.project_phases
  ADD COLUMN IF NOT EXISTS release_mode text NOT NULL DEFAULT 'plan';

ALTER TABLE public.project_phases
  DROP CONSTRAINT IF EXISTS project_phases_release_mode_check;

ALTER TABLE public.project_phases
  ADD CONSTRAINT project_phases_release_mode_check
  CHECK (release_mode IN ('plan', 'open', 'hold'));

COMMENT ON COLUMN public.project_phases.release_mode IS
  'How this phase opens: plan = on planned_start (default), open = admin opened it early, hold = admin keeps it closed. Distinct from status, which is where the phase actually is.';

-- Existing rows default to 'plan', which is exactly how they behave today. Nothing
-- changes for anyone until an admin makes a decision.

-- ─────────────────────────────────────────────────────────────
-- The unlock job, now honouring the admin's intent
-- ─────────────────────────────────────────────────────────────
-- Signature preserved: RETURNS integer, LANGUAGE plpgsql. The cron job and the catch-up
-- call both read the row count, and Postgres will not replace a function whose return
-- type changed.
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
     -- Scope: a phase in no lane is a later programme, not work that is due.
     AND lane_id IS NOT NULL
     AND (
       -- Opened early by an admin. No date test: that is the whole point.
       release_mode = 'open'
       OR (
         release_mode = 'plan'
         AND planned_start IS NOT NULL
         AND planned_start <= CURRENT_DATE
       )
     );
     -- 'hold' matches neither branch, so the job leaves it closed however old its dates.
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$$;

-- Apply immediately, so an admin who sets 'open' does not wait for 01:00 tomorrow.
-- (The app also flips status directly when the admin chooses 'open', so this is a
-- backstop rather than the main path.)
SELECT public.auto_unlock_phases() AS phases_opened_now;

-- ─────────────────────────────────────────────────────────────
-- Check
-- ─────────────────────────────────────────────────────────────
-- What each in-scope phase is doing, and why.
SELECT p.name AS project, ph.phase_number, ph.status, ph.release_mode,
       ph.planned_start,
       CASE
         WHEN ph.release_mode = 'hold'                      THEN 'held closed by admin'
         WHEN ph.release_mode = 'open'                      THEN 'opened early by admin'
         WHEN ph.planned_start IS NULL                      THEN 'no start date — will not open on its own'
         WHEN ph.planned_start <= CURRENT_DATE              THEN 'due — opens on the plan'
         ELSE 'opens ' || ph.planned_start::text
       END AS why
FROM public.project_phases ph
JOIN public.projects p ON p.id = ph.project_id
WHERE ph.lane_id IS NOT NULL
ORDER BY p.name, ph.phase_number;
