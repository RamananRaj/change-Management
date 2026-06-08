-- ChangeFlow: Multi-tenant project structure
-- Enhances projects table + creates project_members join table

-- ─────────────────────────────────────────────────────────────
-- 1. Enhance projects table
-- ─────────────────────────────────────────────────────────────
ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS client_id   uuid REFERENCES public.clients(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS description text,
  ADD COLUMN IF NOT EXISTS status      text DEFAULT 'active'
    CHECK (status IN ('planning', 'active', 'completed', 'on_hold'));

-- ─────────────────────────────────────────────────────────────
-- 2. project_members — many users per project
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.project_members (
  id         uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id uuid REFERENCES public.projects(id) ON DELETE CASCADE NOT NULL,
  user_id    uuid REFERENCES auth.users(id)       ON DELETE CASCADE NOT NULL,
  joined_at  timestamptz DEFAULT now(),
  UNIQUE (project_id, user_id)
);

ALTER TABLE public.project_members ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage project members"
  ON public.project_members FOR ALL
  USING   (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND is_admin = true))
  WITH CHECK (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND is_admin = true));

CREATE POLICY "Users read own project memberships"
  ON public.project_members FOR SELECT
  USING (auth.uid() = user_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.project_members TO authenticated;

-- ─────────────────────────────────────────────────────────────
-- 3. Allow admins to manage projects and project_phases
-- ─────────────────────────────────────────────────────────────
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'projects' AND policyname = 'Admins manage all projects'
  ) THEN
    CREATE POLICY "Admins manage all projects"
      ON public.projects FOR ALL
      USING   (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND is_admin = true))
      WITH CHECK (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND is_admin = true));
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'project_phases' AND policyname = 'Admins manage all project phases'
  ) THEN
    CREATE POLICY "Admins manage all project phases"
      ON public.project_phases FOR ALL
      USING   (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND is_admin = true))
      WITH CHECK (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND is_admin = true));
  END IF;
END $$;

SELECT 'project structure enhanced; project_members created' AS result;
