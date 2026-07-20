-- ChangeFlow: user-defined swimlanes + sub-swimlanes, and dates on every activity.
--
-- Two things happen here:
--   1. project_lanes  — lanes become data instead of the hardcoded 'delivery'/'change'
--                       text on project_milestones. A lane may have a parent lane,
--                       which is what makes it a sub-swimlane. Each carries a tint.
--   2. dates on project_pathways — so every activity (task) has its own window
--                       rather than inheriting the phase start/end.
--
-- Dates live on project_pathways, not phase_content: content is a shared template
-- reused across projects, so a date on it would leak from one programme to another.
-- The pathway row is the per-project instance, which is where a schedule belongs.
--
-- Safe to re-run. Uses public.is_admin() / is_client_admin() / my_client_id().

-- ─────────────────────────────────────────────────────────────
-- 1. project_lanes
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.project_lanes (
  id         uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id uuid REFERENCES public.projects(id)      ON DELETE CASCADE NOT NULL,
  parent_id  uuid REFERENCES public.project_lanes(id) ON DELETE CASCADE,  -- non-null = sub-swimlane
  name       text NOT NULL,
  tint       text,          -- pale hex for the lane band, e.g. #eff6ff
  sort_order int DEFAULT 0,
  created_at timestamptz DEFAULT now()
);

-- One level of nesting only. A sub-lane of a sub-lane has no meaning on a Gantt
-- and makes the row-height maths unbounded, so the DB refuses it outright.
CREATE OR REPLACE FUNCTION public.lane_depth_ok() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE grandparent uuid;
BEGIN
  IF NEW.parent_id IS NOT NULL THEN
    SELECT parent_id INTO grandparent FROM public.project_lanes WHERE id = NEW.parent_id;
    IF grandparent IS NOT NULL THEN
      RAISE EXCEPTION 'lanes nest one level only: % already has a parent', NEW.parent_id;
    END IF;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_lane_depth ON public.project_lanes;
CREATE TRIGGER trg_lane_depth BEFORE INSERT OR UPDATE ON public.project_lanes
  FOR EACH ROW EXECUTE FUNCTION public.lane_depth_ok();

CREATE INDEX IF NOT EXISTS idx_project_lanes_project ON public.project_lanes(project_id, sort_order);

ALTER TABLE public.project_lanes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins manage lanes" ON public.project_lanes;
CREATE POLICY "Admins manage lanes" ON public.project_lanes FOR ALL
  USING (public.is_admin()) WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "Client admins manage their lanes" ON public.project_lanes;
CREATE POLICY "Client admins manage their lanes" ON public.project_lanes FOR ALL
  USING      (public.is_client_admin() AND EXISTS (SELECT 1 FROM public.projects p WHERE p.id = project_lanes.project_id AND p.client_id = public.my_client_id()))
  WITH CHECK (public.is_client_admin() AND EXISTS (SELECT 1 FROM public.projects p WHERE p.id = project_lanes.project_id AND p.client_id = public.my_client_id()));

DROP POLICY IF EXISTS "Members read their project lanes" ON public.project_lanes;
CREATE POLICY "Members read their project lanes" ON public.project_lanes FOR SELECT
  USING (EXISTS (SELECT 1 FROM public.project_members m WHERE m.project_id = project_lanes.project_id AND m.user_id = auth.uid()));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.project_lanes TO authenticated;

-- ─────────────────────────────────────────────────────────────
-- 2. Seed the two lanes every project already has implicitly
-- ─────────────────────────────────────────────────────────────
INSERT INTO public.project_lanes (project_id, name, tint, sort_order)
SELECT p.id, 'Delivery', '#eff6ff', 0
FROM public.projects p
WHERE NOT EXISTS (
  SELECT 1 FROM public.project_lanes l
  WHERE l.project_id = p.id AND l.parent_id IS NULL AND lower(l.name) = 'delivery'
);

INSERT INTO public.project_lanes (project_id, name, tint, sort_order)
SELECT p.id, 'Change', '#f0fdfa', 1
FROM public.projects p
WHERE NOT EXISTS (
  SELECT 1 FROM public.project_lanes l
  WHERE l.project_id = p.id AND l.parent_id IS NULL AND lower(l.name) = 'change'
);

-- ─────────────────────────────────────────────────────────────
-- 3. Point milestones at a lane row
--    The legacy `lane` text column stays for now so nothing breaks mid-deploy;
--    lane_id is backfilled from it and becomes the source of truth in the UI.
-- ─────────────────────────────────────────────────────────────
ALTER TABLE public.project_milestones
  ADD COLUMN IF NOT EXISTS lane_id uuid REFERENCES public.project_lanes(id) ON DELETE SET NULL;

UPDATE public.project_milestones m
SET lane_id = l.id
FROM public.project_lanes l
WHERE m.lane_id IS NULL
  AND l.project_id = m.project_id
  AND l.parent_id IS NULL
  AND lower(l.name) = lower(m.lane);

CREATE INDEX IF NOT EXISTS idx_project_milestones_lane ON public.project_milestones(lane_id);

-- ─────────────────────────────────────────────────────────────
-- 4. Dates + lane on every activity
-- ─────────────────────────────────────────────────────────────
ALTER TABLE public.project_pathways
  ADD COLUMN IF NOT EXISTS starts_on  date,
  ADD COLUMN IF NOT EXISTS ends_on    date,
  ADD COLUMN IF NOT EXISTS lane_id    uuid REFERENCES public.project_lanes(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS color      text,
  ADD COLUMN IF NOT EXISTS sort_order int DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_project_pathways_lane ON public.project_pathways(lane_id);

-- Deliberately NOT backfilling activity dates from the phase window.
-- A date copied off the phase looks like a real commitment but is a guess, and
-- once it is in the table nobody can tell the difference. Undated activities
-- render greyed on the timeline with a "no dates set" hint instead, which is
-- honest and prompts someone to fill them in.

SELECT 'timeline lanes + activity dates added' AS result;
