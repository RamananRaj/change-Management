-- ChangeFlow: remove duplicate project_phases rows and stop them recurring.
--
-- WHAT WAS FOUND
--   'My First Project' had SIX rows for every phase — 30 rows where there should be 5.
--   'Test Project' had one. Nothing enforced one row per (project, phase), so repeated
--   setup runs accumulated silently.
--
-- WHY IT MATTERED ENOUGH TO FIX BEFORE THE MATHS CHANGES
--   The old progress calculation summed steps across phases, which is accidentally
--   immune to duplicate phase ROWS — the same content was counted once regardless.
--   The new calculation averages ONE percentage PER PHASE, so thirty rows would divide
--   by thirty and every phase would carry 3.3% instead of 20%. The bug has been
--   invisible until now and would have become a wrong number the moment scope shipped.
--
--   It was already causing one visible fault: ProjectTimeline updates phase dates by
--   row id, so editing a date only ever changed one of the six. The other five kept
--   whatever they had, and which one the app read was down to row order.
--
-- WHICH ROW SURVIVES
--   The one carrying the most information: a lane, then planned dates, then the oldest.
--   Picking arbitrarily would discard whichever copy someone had actually edited.
--
-- Safe to re-run.

-- ─────────────────────────────────────────────────────────────
-- 1. What are we about to delete?
-- ─────────────────────────────────────────────────────────────
SELECT p.name AS project, count(*) AS phase_rows,
       count(DISTINCT ph.phase_number) AS distinct_phases,
       count(*) - count(DISTINCT ph.phase_number) AS to_delete
FROM public.project_phases ph
JOIN public.projects p ON p.id = ph.project_id
GROUP BY p.name
HAVING count(*) > count(DISTINCT ph.phase_number)
ORDER BY p.name;

-- ─────────────────────────────────────────────────────────────
-- 2. Delete the duplicates, keeping the best row per (project, phase)
-- ─────────────────────────────────────────────────────────────
WITH ranked AS (
  SELECT id,
         row_number() OVER (
           PARTITION BY project_id, phase_number
           ORDER BY
             -- A row already in a lane is the one the scope migration touched.
             (lane_id IS NOT NULL) DESC,
             -- Then whichever carries real dates rather than nulls.
             (planned_start IS NOT NULL) DESC,
             (planned_end   IS NOT NULL) DESC,
             -- Then the original, so an edit made to the first copy survives.
             created_at ASC NULLS LAST,
             id ASC
         ) AS rn
  FROM public.project_phases
)
DELETE FROM public.project_phases ph
USING ranked r
WHERE ph.id = r.id AND r.rn > 1;

-- ─────────────────────────────────────────────────────────────
-- 3. Stop it happening again
-- ─────────────────────────────────────────────────────────────
-- This constraint should have existed from the beginning. A project has exactly one
-- row per phase number by definition — the five phases are the methodology, not a
-- list something can append to. Without it, any setup path that runs twice silently
-- doubles the data and nothing complains until a percentage goes wrong.
ALTER TABLE public.project_phases
  DROP CONSTRAINT IF EXISTS project_phases_project_phase_unique;

ALTER TABLE public.project_phases
  ADD CONSTRAINT project_phases_project_phase_unique UNIQUE (project_id, phase_number);

-- ─────────────────────────────────────────────────────────────
-- 4. Verify: every project should now show its phases once each
-- ─────────────────────────────────────────────────────────────
SELECT p.name AS project,
       count(*) AS phase_rows,
       count(*) FILTER (WHERE ph.lane_id IS NOT NULL) AS in_scope,
       count(*) FILTER (WHERE ph.lane_id IS NULL)     AS deferred
FROM public.project_phases ph
JOIN public.projects p ON p.id = ph.project_id
GROUP BY p.name
ORDER BY p.name;
