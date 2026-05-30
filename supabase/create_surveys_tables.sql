-- ChangeFlow: Survey System
-- surveys           = admin-defined survey groups (one per phase/topic)
-- survey_questions  = individual questions belonging to a survey
-- survey_responses  = per-user answers + calculated score

-- ---
-- 1. Surveys table
-- ---
CREATE TABLE IF NOT EXISTS public.surveys (
  id                        uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  title                     text NOT NULL,
  description               text,
  phase_number              int NOT NULL,
  target_role               text,           -- null = all roles, 'change_manager' = CM only
  rag_green_threshold       numeric DEFAULT 3.5,
  rag_amber_threshold       numeric DEFAULT 2.5,
  is_active                 boolean DEFAULT true,
  sort_order                int DEFAULT 0,
  -- AI insights fields
  ai_insight                text,           -- stored generated insight text
  ai_insight_generated_at   timestamptz,    -- when was it last generated
  ai_insight_response_count int DEFAULT 0,  -- how many responses were included
  created_at                timestamptz DEFAULT now()
);

ALTER TABLE public.surveys ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users read active surveys"
  ON public.surveys FOR SELECT
  USING (is_active = true AND auth.uid() IS NOT NULL);

CREATE POLICY "Admins read all surveys"
  ON public.surveys FOR SELECT
  USING (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND is_admin = true));

CREATE POLICY "Admins manage surveys"
  ON public.surveys FOR ALL
  USING (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND is_admin = true))
  WITH CHECK (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND is_admin = true));

GRANT SELECT ON public.surveys TO authenticated;
GRANT INSERT, UPDATE, DELETE ON public.surveys TO authenticated;

-- ---
-- 2. Survey Questions table
-- ---
CREATE TABLE IF NOT EXISTS public.survey_questions (
  id            uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  survey_id     uuid REFERENCES public.surveys(id) ON DELETE CASCADE NOT NULL,
  question_text text NOT NULL,
  question_type text NOT NULL DEFAULT 'rating'
    CHECK (question_type IN ('rating', 'yes_no', 'single_choice', 'text')),
  options       jsonb DEFAULT '[]',  -- [{label, score}] for single_choice
  is_required   boolean DEFAULT false,
  sort_order    int DEFAULT 0,
  created_at    timestamptz DEFAULT now()
);

-- question_type notes:
-- rating       → user picks 1–5 stars; score = the star value
-- yes_no       → Yes / No buttons; yes = 5, no = 1
-- single_choice → dropdown/radio; score comes from options[].score
-- text         → free-text textarea; no score contribution

ALTER TABLE public.survey_questions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users read survey questions"
  ON public.survey_questions FOR SELECT
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "Admins manage survey questions"
  ON public.survey_questions FOR ALL
  USING (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND is_admin = true))
  WITH CHECK (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND is_admin = true));

GRANT SELECT ON public.survey_questions TO authenticated;
GRANT INSERT, UPDATE, DELETE ON public.survey_questions TO authenticated;

-- ---
-- 3. Survey Responses table
-- ---
CREATE TABLE IF NOT EXISTS public.survey_responses (
  id           uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  survey_id    uuid REFERENCES public.surveys(id) ON DELETE CASCADE NOT NULL,
  user_id      uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  answers      jsonb NOT NULL DEFAULT '{}',  -- { question_id: answer_value }
  score        numeric,                       -- calculated avg score 1–5
  submitted_at timestamptz,                   -- null = in progress, set = submitted
  updated_at   timestamptz DEFAULT now(),
  UNIQUE (survey_id, user_id)
);

-- answers JSONB structure:
-- { "uuid-of-q1": 4, "uuid-of-q2": "yes", "uuid-of-q3": "Strongly agree", "uuid-of-q4": "Free text..." }

ALTER TABLE public.survey_responses ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own survey responses"
  ON public.survey_responses FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Admins read all survey responses"
  ON public.survey_responses FOR SELECT
  USING (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND is_admin = true));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.survey_responses TO authenticated;

SELECT 'surveys, survey_questions, survey_responses tables created successfully' AS result;
