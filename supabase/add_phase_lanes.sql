-- ChangeFlow: Change phases join the swimlanes, and lane membership becomes scope.
--
-- WHAT THIS CHANGES
--   project_lanes already exists and is generic (project-scoped, tinted, one level of
--   nesting). Delivery activities and milestones already sit in lanes. This lets the
--   five Change phases sit in them too.
--
-- THE IDEA THAT MAKES IT SIMPLE
--   Lane membership IS scope. A client running only Diagnose and Design puts those two
--   in a lane; the other three sit in no lane and are not being run. There is no
--   separate "in scope" flag to keep in agreement with the lane — one place to look to
--   answer "what are we actually running".
--
--   The five phases are untouched as a methodology. Nothing is deleted, and the phases
--   not being run are still defined; they are simply not part of this programme.
--
-- WHY THIS IS NOT MERELY HIDING
--   Progress used to be sum(done)/sum(total) across ALL five phases. A client running
--   two would have read as ~40% complete forever, and CORA would have reported three
--   overdue phases nobody was running. Scope has to reach the denominator, not just the
--   screen. The maths lives in projectProgress() in analysis.js, which averages the
--   phases in scope and ignores the rest.
--
-- BACKWARDS COMPATIBILITY
--   Every existing project gets a default lane containing all five phases, so nothing
--   changes for anyone until a client deliberately narrows their scope. A project with
--   no lanes at all would otherwise compute as "running nothing", which is wrong and
--   would blank every number.
--
-- Safe to re-run.

ALTER TABLE public.project_phases
  -- NULL = this phase is not part of the current programme. Deliberately nullable:
  -- "not being run" is a real state, distinct from "in a lane and not started".
  ADD COLUMN IF NOT EXISTS lane_id uuid REFERENCES public.project_lanes(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_project_phases_lane ON public.project_phases(lane_id);

-- ─────────────────────────────────────────────────────────────
-- Backfill: one lane per existing project, holding all five phases
-- ─────────────────────────────────────────────────────────────
-- Without this every existing project would suddenly be running no phases, and every
-- percentage in the product would go blank. The default is "you are running all five",
-- which is what every current project actually means.
DO $$
DECLARE r record; v_lane uuid;
BEGIN
  FOR r IN SELECT DISTINCT p.id, p.name FROM public.projects p LOOP
    -- Reuse a lane called 'Change' if one already exists for this project, so re-running
    -- does not accumulate duplicates.
    SELECT id INTO v_lane FROM public.project_lanes
    WHERE project_id = r.id AND name = 'Change programme' LIMIT 1;

    IF v_lane IS NULL THEN
      INSERT INTO public.project_lanes (project_id, name, tint, sort_order)
      VALUES (r.id, 'Change programme', '#eff6ff', 0)
      RETURNING id INTO v_lane;
    END IF;

    UPDATE public.project_phases
    SET lane_id = v_lane
    WHERE project_id = r.id AND lane_id IS NULL;
  END LOOP;
END $$;

-- ─────────────────────────────────────────────────────────────
-- What is in scope, and what is not
-- ─────────────────────────────────────────────────────────────
-- A view so the UI, CORA and the report cannot each decide for themselves what "in
-- scope" means — the same mistake that let the heat map go stale in the Word pack
-- while the canvas showed live data.
CREATE OR REPLACE VIEW public.project_phase_scope AS
SELECT
  ph.project_id,
  ph.phase_number,
  ph.lane_id,
  l.name  AS lane_name,
  l.tint  AS lane_tint,
  l.sort_order AS lane_order,
  ph.planned_start,
  ph.planned_end,
  ph.status,
  (ph.lane_id IS NOT NULL) AS in_scope
FROM public.project_phases ph
LEFT JOIN public.project_lanes l ON l.id = ph.lane_id;

GRANT SELECT ON public.project_phase_scope TO authenticated;

-- Check: every project should show five rows, all in scope, after the backfill.
SELECT p.name AS project,
       count(*) FILTER (WHERE s.in_scope)     AS in_scope,
       count(*) FILTER (WHERE NOT s.in_scope) AS deferred,
       string_agg(DISTINCT s.lane_name, ', ') AS lanes
FROM public.project_phase_scope s
JOIN public.projects p ON p.id = s.project_id
GROUP BY p.name
ORDER BY p.name;
