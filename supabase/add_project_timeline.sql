-- ChangeFlow: Project timeline — a delivery track (milestones/bands) plus the
-- ChangeFlow phases as a second track, on a shared time axis.
-- Editable by Master Admin and the project's Client Admin; readable by members.
-- Safe to re-run. Uses is_admin(), is_client_admin(), my_client_id().

-- ─────────────────────────────────────────────────────────────
-- 1. Planned dates on the change phases (drives the Change track)
-- ─────────────────────────────────────────────────────────────
ALTER TABLE public.project_phases ADD COLUMN IF NOT EXISTS planned_start date;
ALTER TABLE public.project_phases ADD COLUMN IF NOT EXISTS planned_end   date;

-- ─────────────────────────────────────────────────────────────
-- 2. Timeline items — milestones (a point) OR bands (a span), in either lane
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.project_milestones (
  id          uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id  uuid REFERENCES public.projects(id) ON DELETE CASCADE NOT NULL,
  name        text NOT NULL,
  lane        text DEFAULT 'delivery' CHECK (lane IN ('delivery','change')),
  milestone_date date,          -- set for a point-in-time flag (e.g. Go-Live)
  starts_on   date,             -- set (with ends_on) for a band (e.g. Build)
  ends_on     date,
  color       text,             -- optional hex for the marker/band
  sort_order  int DEFAULT 0,
  created_at  timestamptz DEFAULT now()
);

ALTER TABLE public.project_milestones ENABLE ROW LEVEL SECURITY;

-- Master admin manages all
DROP POLICY IF EXISTS "Admins manage milestones" ON public.project_milestones;
CREATE POLICY "Admins manage milestones" ON public.project_milestones FOR ALL
  USING (public.is_admin()) WITH CHECK (public.is_admin());

-- Client admin manages milestones on their own client's projects
DROP POLICY IF EXISTS "Client admins manage their milestones" ON public.project_milestones;
CREATE POLICY "Client admins manage their milestones" ON public.project_milestones FOR ALL
  USING      (public.is_client_admin() AND EXISTS (SELECT 1 FROM public.projects p WHERE p.id = project_milestones.project_id AND p.client_id = public.my_client_id()))
  WITH CHECK (public.is_client_admin() AND EXISTS (SELECT 1 FROM public.projects p WHERE p.id = project_milestones.project_id AND p.client_id = public.my_client_id()));

-- Members read milestones for projects they belong to
DROP POLICY IF EXISTS "Members read their project milestones" ON public.project_milestones;
CREATE POLICY "Members read their project milestones" ON public.project_milestones FOR SELECT
  USING (EXISTS (SELECT 1 FROM public.project_members m WHERE m.project_id = project_milestones.project_id AND m.user_id = auth.uid()));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.project_milestones TO authenticated;

SELECT 'project timeline: phase dates + project_milestones added' AS result;
