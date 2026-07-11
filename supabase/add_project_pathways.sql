-- ChangeFlow: per-PROJECT content pathways (replaces per-client client_pathways)
-- + RLS so non-admin members can actually read their project, its phase access,
--   and its pathway. Migrates any existing client_pathways into each project.
-- Safe to re-run. Uses public.is_admin() (from add_admin_read_profiles.sql).

-- ─────────────────────────────────────────────────────────────
-- 1. project_pathways table
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.project_pathways (
  id           uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id   uuid REFERENCES public.projects(id)      ON DELETE CASCADE NOT NULL,
  phase_number int NOT NULL,
  content_id   uuid REFERENCES public.phase_content(id) ON DELETE CASCADE NOT NULL,
  pathway_step int NOT NULL,
  created_at   timestamptz DEFAULT now(),
  UNIQUE (project_id, phase_number, pathway_step)
);

ALTER TABLE public.project_pathways ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins manage project pathways" ON public.project_pathways;
CREATE POLICY "Admins manage project pathways"
  ON public.project_pathways FOR ALL
  USING (public.is_admin()) WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "Members read their project pathways" ON public.project_pathways;
CREATE POLICY "Members read their project pathways"
  ON public.project_pathways FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM public.project_members m
    WHERE m.project_id = project_pathways.project_id AND m.user_id = auth.uid()
  ));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.project_pathways TO authenticated;

-- ─────────────────────────────────────────────────────────────
-- 2. RLS so members can read their projects + phase access
-- ─────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Members read their projects" ON public.projects;
CREATE POLICY "Members read their projects"
  ON public.projects FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM public.project_members m
    WHERE m.project_id = projects.id AND m.user_id = auth.uid()
  ));

DROP POLICY IF EXISTS "Members read their project phases" ON public.project_phases;
CREATE POLICY "Members read their project phases"
  ON public.project_phases FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM public.project_members m
    WHERE m.project_id = project_phases.project_id AND m.user_id = auth.uid()
  ));

-- ─────────────────────────────────────────────────────────────
-- 3. Migrate existing per-client pathways into each project
--    (each project under a client inherits that client's pathway as a starting point)
-- ─────────────────────────────────────────────────────────────
INSERT INTO public.project_pathways (project_id, phase_number, content_id, pathway_step)
SELECT p.id, cp.phase_number, cp.content_id, cp.pathway_step
FROM public.client_pathways cp
JOIN public.projects p ON p.client_id = cp.client_id
ON CONFLICT (project_id, phase_number, pathway_step) DO NOTHING;

SELECT 'project_pathways created; member RLS added; migrated from client_pathways' AS result;
