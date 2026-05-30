-- ChangeFlow: Templates System
-- templates       = admin-defined template structures with column definitions
-- template_responses = user-filled row data per template

-- ---
-- 1. Templates table
-- ---
CREATE TABLE IF NOT EXISTS public.templates (
  id           uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  title        text NOT NULL,
  description  text,
  phase_number int NOT NULL,
  industry     text,
  role         text,
  columns      jsonb NOT NULL DEFAULT '[]',
  file_url     text,
  sort_order   int DEFAULT 0,
  is_active    boolean DEFAULT true,
  created_at   timestamptz DEFAULT now()
);

-- columns JSONB structure (each element):
-- {
--   "key":      "stakeholder_name",   -- unique field key (snake_case)
--   "label":    "Stakeholder Name",   -- display header
--   "type":     "text",               -- text | number | date | select | rating | checkbox
--   "required": true,
--   "options":  ["High","Medium","Low"]  -- only for type=select
-- }

ALTER TABLE public.templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone authenticated can read active templates"
  ON public.templates FOR SELECT
  USING (is_active = true AND auth.uid() IS NOT NULL);

CREATE POLICY "Admins can read all templates"
  ON public.templates FOR SELECT
  USING (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND is_admin = true));

CREATE POLICY "Admins can manage templates"
  ON public.templates FOR ALL
  USING (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND is_admin = true))
  WITH CHECK (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND is_admin = true));

GRANT SELECT ON public.templates TO authenticated;
GRANT INSERT, UPDATE, DELETE ON public.templates TO authenticated;

-- ---
-- 2. Template Responses table
-- ---
CREATE TABLE IF NOT EXISTS public.template_responses (
  id           uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id      uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  template_id  uuid REFERENCES public.templates(id) ON DELETE CASCADE NOT NULL,
  rows         jsonb NOT NULL DEFAULT '[]',
  status       text NOT NULL DEFAULT 'in_progress' CHECK (status IN ('in_progress', 'completed')),
  updated_at   timestamptz DEFAULT now(),
  completed_at timestamptz,
  UNIQUE (user_id, template_id)
);

-- rows JSONB structure (array of row objects):
-- [
--   { "stakeholder_name": "Jane Smith", "influence": "High", "sentiment": 4, "action": "Monthly briefings" },
--   { "stakeholder_name": "Tom Lee",    "influence": "Medium", "sentiment": 2, "action": "Change champion" }
-- ]

ALTER TABLE public.template_responses ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own template responses"
  ON public.template_responses FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Admins can read all template responses"
  ON public.template_responses FOR SELECT
  USING (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND is_admin = true));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.template_responses TO authenticated;

SELECT 'templates and template_responses tables created successfully' AS result;
