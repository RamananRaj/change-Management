-- ChangeFlow: Client Admin role (scoped to a single client) + per-client stakeholders
-- A Client Admin manages ONLY their own client's projects, users, invites, phase
-- access and stakeholders. Content/pathways stay with the Master Admin (is_admin).
-- Elevation to Client Admin stays a Master-Admin action. Safe to re-run.

-- ─────────────────────────────────────────────────────────────
-- 1. Flag + helper functions (SECURITY DEFINER avoids recursive RLS on profiles)
-- ─────────────────────────────────────────────────────────────
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS is_client_admin boolean DEFAULT false;

CREATE OR REPLACE FUNCTION public.is_client_admin()
RETURNS boolean LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND is_client_admin = true);
$$;
GRANT EXECUTE ON FUNCTION public.is_client_admin() TO authenticated;

CREATE OR REPLACE FUNCTION public.my_client_id()
RETURNS uuid LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS $$
  SELECT client_id FROM public.profiles WHERE id = auth.uid();
$$;
GRANT EXECUTE ON FUNCTION public.my_client_id() TO authenticated;

-- ─────────────────────────────────────────────────────────────
-- 2. Scoped management RLS (additive — combines with existing admin/member policies)
-- ─────────────────────────────────────────────────────────────
-- Projects
DROP POLICY IF EXISTS "Client admins manage their projects" ON public.projects;
CREATE POLICY "Client admins manage their projects" ON public.projects FOR ALL
  USING      (public.is_client_admin() AND client_id = public.my_client_id())
  WITH CHECK (public.is_client_admin() AND client_id = public.my_client_id());

-- Project members
DROP POLICY IF EXISTS "Client admins manage their members" ON public.project_members;
CREATE POLICY "Client admins manage their members" ON public.project_members FOR ALL
  USING      (public.is_client_admin() AND EXISTS (SELECT 1 FROM public.projects p WHERE p.id = project_members.project_id AND p.client_id = public.my_client_id()))
  WITH CHECK (public.is_client_admin() AND EXISTS (SELECT 1 FROM public.projects p WHERE p.id = project_members.project_id AND p.client_id = public.my_client_id()));

-- Project invites
DROP POLICY IF EXISTS "Client admins manage their invites" ON public.project_invites;
CREATE POLICY "Client admins manage their invites" ON public.project_invites FOR ALL
  USING      (public.is_client_admin() AND client_id = public.my_client_id())
  WITH CHECK (public.is_client_admin() AND client_id = public.my_client_id());

-- Project phases
DROP POLICY IF EXISTS "Client admins manage their project phases" ON public.project_phases;
CREATE POLICY "Client admins manage their project phases" ON public.project_phases FOR ALL
  USING      (public.is_client_admin() AND EXISTS (SELECT 1 FROM public.projects p WHERE p.id = project_phases.project_id AND p.client_id = public.my_client_id()))
  WITH CHECK (public.is_client_admin() AND EXISTS (SELECT 1 FROM public.projects p WHERE p.id = project_phases.project_id AND p.client_id = public.my_client_id()));

-- Profiles: client admins can read the users belonging to their client (to list/manage them)
DROP POLICY IF EXISTS "Client admins read their client profiles" ON public.profiles;
CREATE POLICY "Client admins read their client profiles" ON public.profiles FOR SELECT
  USING (public.is_client_admin() AND client_id = public.my_client_id());

-- ─────────────────────────────────────────────────────────────
-- 3. Per-client stakeholders
-- ─────────────────────────────────────────────────────────────
ALTER TABLE public.stakeholders ADD COLUMN IF NOT EXISTS client_id uuid REFERENCES public.clients(id) ON DELETE CASCADE;

-- Client admins manage their own client's stakeholders
DROP POLICY IF EXISTS "Client admins manage their stakeholders" ON public.stakeholders;
CREATE POLICY "Client admins manage their stakeholders" ON public.stakeholders FOR ALL
  USING      (public.is_client_admin() AND client_id = public.my_client_id())
  WITH CHECK (public.is_client_admin() AND client_id = public.my_client_id());

-- Read scope: any signed-in user sees active stakeholders that are global (client_id null)
-- or belong to their own client. (Replaces the old "all active" read policy.)
DROP POLICY IF EXISTS "Authenticated read active stakeholders" ON public.stakeholders;
DROP POLICY IF EXISTS "Read active stakeholders in scope" ON public.stakeholders;
CREATE POLICY "Read active stakeholders in scope" ON public.stakeholders FOR SELECT TO authenticated
  USING (is_active = true AND (client_id IS NULL OR client_id = public.my_client_id()));

SELECT 'client_admin role + scoped RLS + per-client stakeholders added' AS result;
