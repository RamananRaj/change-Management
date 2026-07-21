-- ChangeFlow: auto-unlock must respect programme scope.
--
-- THE FAULT
--   auto_unlock_phases() opens any 'locked' phase whose planned_start has arrived. It was
--   written before scope existed, so it has no idea that a phase can be deliberately out
--   of the programme. Defer a phase that already carries dates and the nightly cron job
--   will flip it to 'active' and put it back in front of the client.
--
--   Nothing in the app would report this. The admin sets scope in the morning; the job
--   undoes part of it overnight; the next person to look sees a phase that is active,
--   out of scope, and has no explanation for how it got there.
--
-- WHY IT HAS NOT BITTEN YET
--   Kestrel's deferred phases (3-5) have NULL planned_start, so the date test never
--   passes. That is luck, not design — deferring a phase mid-programme is exactly the
--   case where dates already exist, and that is the case this would break.
--
-- THE RULE, STATED PROPERLY
--   A phase opens when its start date arrives AND it is part of the programme.
--   Lane membership IS scope, so that second condition is `lane_id IS NOT NULL`.
--
-- Safe to re-run.

-- Signature preserved exactly: RETURNS integer, LANGUAGE plpgsql. The cron job reads the
-- returned row count, and Postgres refuses to replace a function whose return type has
-- changed — so only the WHERE clause moves here.
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
     AND planned_start <= CURRENT_DATE
     -- Scope. A phase in no lane is a later programme; its dates describe when that
     -- work is expected to happen, not permission to start it now.
     AND lane_id IS NOT NULL;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$$;

-- ─────────────────────────────────────────────────────────────
-- Repair: did the job already open anything out of scope?
-- ─────────────────────────────────────────────────────────────
-- Look before changing anything. If this returns rows, the job has been running against
-- deferred phases and those need re-locking; if it returns nothing, the fix above is
-- purely preventative.
SELECT p.id AS project_id, p.name AS project, ph.phase_number, ph.status, ph.planned_start
FROM public.project_phases ph
JOIN public.projects p ON p.id = ph.project_id
WHERE ph.lane_id IS NULL
  AND ph.status <> 'locked'
ORDER BY p.name, ph.phase_number;

-- Re-lock them. Commented out deliberately: run the SELECT first and read what it
-- returns. A phase marked 'completed' before it was deferred is a real record of work
-- that was actually done, and blindly re-locking it would erase that.
--
-- RUN ONCE on 2026-07-21 against production. It found two rows — Kestrel's Engage and
-- Embed, both 'active' and out of scope. Worth recording that the CRON JOB WAS NOT THE
-- CAUSE: both had a NULL planned_start, which the unlock rule requires, so it could not
-- have touched them. They had been cycled open by hand through the old phase-access
-- strip, back when that control offered all five phases regardless of scope. The fix
-- above is therefore preventative; this repair cleaned up after a different control.
--
-- UPDATE public.project_phases
--    SET status = 'locked'
--  WHERE lane_id IS NULL AND status = 'active';

-- ─────────────────────────────────────────────────────────────
-- Verify the rule
-- ─────────────────────────────────────────────────────────────
-- Every phase that WOULD unlock on the next run, and whether scope allows it.
-- Expect: no row where in_scope is false.
SELECT p.name AS project, ph.phase_number, ph.planned_start,
       (ph.lane_id IS NOT NULL) AS in_scope
FROM public.project_phases ph
JOIN public.projects p ON p.id = ph.project_id
WHERE ph.status = 'locked'
  AND ph.planned_start IS NOT NULL
  AND ph.planned_start <= CURRENT_DATE
ORDER BY in_scope, p.name, ph.phase_number;
