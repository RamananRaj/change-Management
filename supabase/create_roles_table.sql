-- ChangeFlow: Dynamic Roles Table
-- Run this in the Supabase SQL Editor

CREATE TABLE IF NOT EXISTS public.roles (
  id          uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  code        text UNIQUE NOT NULL,
  label       text NOT NULL,
  icon        text DEFAULT '🔷',
  description text,
  detail      text,
  is_active   boolean DEFAULT true,
  sort_order  int DEFAULT 0,
  created_at  timestamptz DEFAULT now()
);

-- RLS
ALTER TABLE public.roles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage roles"
  ON public.roles FOR ALL
  USING (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND is_admin = true))
  WITH CHECK (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND is_admin = true));

CREATE POLICY "Users can read roles"
  ON public.roles FOR SELECT
  USING (auth.role() = 'authenticated');

GRANT SELECT, INSERT, UPDATE, DELETE ON public.roles TO authenticated;

-- Seed the 3 existing roles
INSERT INTO public.roles (code, label, icon, description, detail, sort_order) VALUES
  ('po', 'Product Owner',    '🔷', 'Vision, requirements & acceptance criteria', 'Owns product vision, defines change requirements, manages product stakeholders.', 10),
  ('cm', 'Change Manager',   '🔶', 'People, stakeholders & adoption',             'Leads stakeholder engagement, builds comms plans, drives adoption and reinforcement.', 20),
  ('pm', 'Project Manager',  '🟩', 'Governance, timeline & risk',                 'Owns project plan, manages risks and dependencies, tracks delivery milestones.', 30)
ON CONFLICT (code) DO NOTHING;

SELECT * FROM public.roles ORDER BY sort_order;
