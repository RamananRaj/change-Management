-- ChangeFlow: scope becomes a decision that is recorded, not a default nobody looked at.
--
-- THE BUG THIS FIXES FIRST
--   saveProject() inserts five project_phases rows on creation — all 'locked', all with
--   NO lane. Scope is read as lane membership, so as of the scope release every NEWLY
--   CREATED project has zero phases in scope: no percentages, nothing on the client's
--   dashboard, all five phases sitting under "not in this programme".
--
--   Existing projects escaped it only because add_phase_lanes.sql backfilled them into a
--   lane. The app-side fallback ("no phase rows saved means scope not chosen, treat all
--   five as in scope") never fires, because the rows DO exist — they just have no lane.
--   The fallback tested the wrong thing.
--
-- THE DISTINCTION THAT WAS MISSING
--   "Running all five" and "nobody has decided yet" produce identical data. Both look
--   like five phases in a lane. That is the same failure this project keeps hitting in
--   other forms: an unknown rendering as a confident value.
--
--   scope_confirmed_at separates them. A project runs all five by default so nothing is
--   broken on day one, but until someone confirms it, the platform says so rather than
--   presenting an untouched default as a plan.
--
-- Safe to re-run.

-- ─────────────────────────────────────────────────────────────
-- 1. Record the decision
-- ─────────────────────────────────────────────────────────────
ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS scope_confirmed_at timestamptz;

ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS scope_confirmed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.projects.scope_confirmed_at IS
  'When an admin confirmed which phases this programme runs. NULL means the project is on the default (all five) and nobody has reviewed it.';

-- ─────────────────────────────────────────────────────────────
-- 2. Repair projects created since the scope release
-- ─────────────────────────────────────────────────────────────
-- Any project whose phases are ALL unlaned was created after scope shipped and never
-- picked up the backfill. It currently reads as running nothing.
--
-- Note the condition: EVERY phase unlaned. A project with SOME phases in a lane is a
-- deliberate narrowing — Kestrel — and must not be touched. Getting this wrong would
-- silently widen a client's programme back to five phases.
DO $$
DECLARE r record; v_lane uuid;
BEGIN
  FOR r IN
    SELECT p.id, p.name
    FROM public.projects p
    WHERE EXISTS (SELECT 1 FROM public.project_phases ph WHERE ph.project_id = p.id)
      AND NOT EXISTS (
        SELECT 1 FROM public.project_phases ph
        WHERE ph.project_id = p.id AND ph.lane_id IS NOT NULL
      )
  LOOP
    SELECT id INTO v_lane FROM public.project_lanes
    WHERE project_id = r.id AND name = 'Change programme' LIMIT 1;

    IF v_lane IS NULL THEN
      INSERT INTO public.project_lanes (project_id, name, tint, sort_order)
      VALUES (r.id, 'Change programme', '#eff6ff', 0)
      RETURNING id INTO v_lane;
    END IF;

    UPDATE public.project_phases SET lane_id = v_lane WHERE project_id = r.id;
    RAISE NOTICE 'Repaired scope for project % (%)', r.name, r.id;
  END LOOP;
END $$;

-- These repaired projects are deliberately left with scope_confirmed_at NULL. They are
-- on the default, and that is exactly what the badge should tell whoever opens them.

-- ─────────────────────────────────────────────────────────────
-- 3. Check
-- ─────────────────────────────────────────────────────────────
-- Expect: no project with 0 in scope. Kestrel confirmed or not, but 2 in scope.
SELECT c.name AS client, p.name AS project, p.id AS project_id,
       count(*) FILTER (WHERE ph.lane_id IS NOT NULL) AS in_scope,
       count(*) FILTER (WHERE ph.lane_id IS NULL)     AS deferred,
       CASE WHEN p.scope_confirmed_at IS NULL
            THEN 'on the default — not confirmed'
            ELSE 'confirmed ' || p.scope_confirmed_at::date::text END AS scope_status
FROM public.projects p
JOIN public.clients c ON c.id = p.client_id
LEFT JOIN public.project_phases ph ON ph.project_id = p.id
GROUP BY c.name, p.name, p.id, p.scope_confirmed_at
ORDER BY c.name, p.name;
