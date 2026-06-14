-- ChangeFlow: Stakeholders (admin-managed shared list)
-- Used by the new "Stakeholder" template column type: a later exercise can let
-- users pick which of these stakeholders are impacted.
-- Safe to re-run. Uses public.is_admin() (from add_admin_read_profiles.sql).

CREATE TABLE IF NOT EXISTS public.stakeholders (
  id          uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  name        text NOT NULL,
  detail      text,                       -- role / department / notes
  is_active   boolean DEFAULT true,
  sort_order  int DEFAULT 0,
  created_at  timestamptz DEFAULT now()
);

ALTER TABLE public.stakeholders ENABLE ROW LEVEL SECURITY;

-- Any signed-in user can read the active list (to populate pick-lists)
DROP POLICY IF EXISTS "Authenticated read active stakeholders" ON public.stakeholders;
CREATE POLICY "Authenticated read active stakeholders"
  ON public.stakeholders FOR SELECT TO authenticated
  USING (is_active = true);

-- Admins can read all (incl. inactive) and manage
DROP POLICY IF EXISTS "Admins read all stakeholders" ON public.stakeholders;
CREATE POLICY "Admins read all stakeholders"
  ON public.stakeholders FOR SELECT
  USING (public.is_admin());

DROP POLICY IF EXISTS "Admins manage stakeholders" ON public.stakeholders;
CREATE POLICY "Admins manage stakeholders"
  ON public.stakeholders FOR ALL
  USING (public.is_admin()) WITH CHECK (public.is_admin());

GRANT SELECT, INSERT, UPDATE, DELETE ON public.stakeholders TO authenticated;

SELECT 'stakeholders table created' AS result;
