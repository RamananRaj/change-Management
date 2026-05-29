-- ChangeFlow: Industries Table
-- Stores the industry options shown in onboarding and used to filter phase content.
-- Admins can add/edit/deactivate industries via the Admin > Industry Manager tab.

CREATE TABLE IF NOT EXISTS public.industries (
  id          uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  code        text UNIQUE NOT NULL,
  label       text NOT NULL,
  icon        text DEFAULT '🏢',
  detail      text,
  is_active   boolean DEFAULT true,
  sort_order  int DEFAULT 0,
  created_at  timestamptz DEFAULT now()
);

ALTER TABLE public.industries ENABLE ROW LEVEL SECURITY;

-- Everyone (including anon) can read active industries for onboarding
CREATE POLICY "Anyone can read active industries"
  ON public.industries FOR SELECT
  USING (is_active = true);

-- Admins can read all (including inactive)
CREATE POLICY "Admins can read all industries"
  ON public.industries FOR SELECT
  USING (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND is_admin = true));

-- Only admins can insert, update, delete
CREATE POLICY "Admins can manage industries"
  ON public.industries FOR ALL
  USING (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND is_admin = true))
  WITH CHECK (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND is_admin = true));

GRANT SELECT ON public.industries TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON public.industries TO authenticated;

-- Seed with the 7 existing industries
INSERT INTO public.industries (code, label, icon, detail, sort_order) VALUES
  ('financial-services', 'Financial Services',  '🏦', 'ADKAR + Regulatory',       10),
  ('healthcare',         'Healthcare',           '🏥', 'ADKAR + Clinical Gov.',     20),
  ('utilities-energy',   'Utilities & Energy',   '⚡', 'Kotter + Safety + ADKAR',  30),
  ('telecommunications', 'Telecommunications',   '📡', 'Agile Change + ADKAR',      40),
  ('manufacturing',      'Manufacturing',        '🏭', 'Lewin + ADKAR + Lean',      50),
  ('public-sector',      'Public Sector',        '🏛', 'ADKAR + MSP/PRINCE2',       60),
  ('retail-consumer',    'Retail & Consumer',    '🛒', 'Agile + ADKAR',             70)
ON CONFLICT (code) DO NOTHING;

SELECT 'industries table created successfully' AS result;
