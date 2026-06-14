-- ChangeFlow: Role Mappings (admin-managed shared list)
-- Used by the new "Role picker" template column type — a template can let users
-- pick from this list of roles. Separate from the onboarding Role Manager.
-- Safe to re-run. Uses public.is_admin() (from add_admin_read_profiles.sql).

CREATE TABLE IF NOT EXISTS public.role_mappings (
  id          uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  name        text NOT NULL,
  detail      text,                       -- description / mapping note
  is_active   boolean DEFAULT true,
  sort_order  int DEFAULT 0,
  created_at  timestamptz DEFAULT now()
);

ALTER TABLE public.role_mappings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated read active role mappings" ON public.role_mappings;
CREATE POLICY "Authenticated read active role mappings"
  ON public.role_mappings FOR SELECT TO authenticated
  USING (is_active = true);

DROP POLICY IF EXISTS "Admins read all role mappings" ON public.role_mappings;
CREATE POLICY "Admins read all role mappings"
  ON public.role_mappings FOR SELECT
  USING (public.is_admin());

DROP POLICY IF EXISTS "Admins manage role mappings" ON public.role_mappings;
CREATE POLICY "Admins manage role mappings"
  ON public.role_mappings FOR ALL
  USING (public.is_admin()) WITH CHECK (public.is_admin());

GRANT SELECT, INSERT, UPDATE, DELETE ON public.role_mappings TO authenticated;

SELECT 'role_mappings table created' AS result;
