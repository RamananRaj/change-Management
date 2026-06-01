-- ChangeFlow: User Activities Table
-- Tracks which exercises/tools/templates each user has started or completed

CREATE TABLE IF NOT EXISTS public.user_activities (
  id           uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id      uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  content_id   uuid REFERENCES public.phase_content(id) ON DELETE CASCADE NOT NULL,
  phase_number int NOT NULL,
  status       text NOT NULL DEFAULT 'in_progress' CHECK (status IN ('in_progress', 'completed')),
  notes        text,
  started_at   timestamptz DEFAULT now(),
  completed_at timestamptz,
  updated_at   timestamptz DEFAULT now(),
  UNIQUE (user_id, content_id)
);

ALTER TABLE public.user_activities ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own activities"
  ON public.user_activities FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Admins can read all activities"
  ON public.user_activities FOR SELECT
  USING (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND is_admin = true));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_activities TO authenticated;

SELECT 'user_activities table created successfully' AS result;
