-- ChangeFlow: fix infinite recursion between projects <-> project_members RLS.
-- The members-read policies (on projects/phases/pathways/milestones) query
-- project_members, and the client-admin policies (on members/phases/milestones)
-- query projects — a mutual loop. We break it with SECURITY DEFINER helpers that
-- read those tables WITHOUT re-triggering RLS. Safe to re-run.

-- Helper: a project's client_id (bypasses projects RLS)
CREATE OR REPLACE FUNCTION public.project_client_id(p_id uuid)
RETURNS uuid LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS $$
  SELECT client_id FROM public.projects WHERE id = p_id;
$$;
GRANT EXECUTE ON FUNCTION public.project_client_id(uuid) TO authenticated;

-- Helper: is the caller a member of a project (bypasses project_members RLS)
CREATE OR REPLACE FUNCTION public.is_project_member(p_id uuid)
RETURNS boolean LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.project_members WHERE project_id = p_id AND user_id = auth.uid());
$$;
GRANT EXECUTE ON FUNCTION public.is_project_member(uuid) TO authenticated;

-- ── projects: members read (via helper, no direct project_members query) ──
DROP POLICY IF EXISTS "Members read their projects" ON public.projects;
CREATE POLICY "Members read their projects" ON public.projects FOR SELECT
  USING (public.is_project_member(projects.id));

-- ── project_members: client admins manage (via helper, no direct projects query) ──
DROP POLICY IF EXISTS "Client admins manage their members" ON public.project_members;
CREATE POLICY "Client admins manage their members" ON public.project_members FOR ALL
  USING      (public.is_client_admin() AND public.project_client_id(project_members.project_id) = public.my_client_id())
  WITH CHECK (public.is_client_admin() AND public.project_client_id(project_members.project_id) = public.my_client_id());

-- ── project_phases ──
DROP POLICY IF EXISTS "Members read their project phases" ON public.project_phases;
CREATE POLICY "Members read their project phases" ON public.project_phases FOR SELECT
  USING (public.is_project_member(project_phases.project_id));
DROP POLICY IF EXISTS "Client admins manage their project phases" ON public.project_phases;
CREATE POLICY "Client admins manage their project phases" ON public.project_phases FOR ALL
  USING      (public.is_client_admin() AND public.project_client_id(project_phases.project_id) = public.my_client_id())
  WITH CHECK (public.is_client_admin() AND public.project_client_id(project_phases.project_id) = public.my_client_id());

-- ── project_pathways ──
DROP POLICY IF EXISTS "Members read their project pathways" ON public.project_pathways;
CREATE POLICY "Members read their project pathways" ON public.project_pathways FOR SELECT
  USING (public.is_project_member(project_pathways.project_id));

-- ── project_milestones ──
DROP POLICY IF EXISTS "Members read their project milestones" ON public.project_milestones;
CREATE POLICY "Members read their project milestones" ON public.project_milestones FOR SELECT
  USING (public.is_project_member(project_milestones.project_id));
DROP POLICY IF EXISTS "Client admins manage their milestones" ON public.project_milestones;
CREATE POLICY "Client admins manage their milestones" ON public.project_milestones FOR ALL
  USING      (public.is_client_admin() AND public.project_client_id(project_milestones.project_id) = public.my_client_id())
  WITH CHECK (public.is_client_admin() AND public.project_client_id(project_milestones.project_id) = public.my_client_id());

SELECT 'project RLS recursion fixed' AS result;
