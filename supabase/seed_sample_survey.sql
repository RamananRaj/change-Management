-- ChangeFlow: Sample Survey Seed
-- Inserts one Phase 1 survey with 5 questions covering all question types.
-- Run this AFTER create_surveys_tables.sql has been executed.

DO $$
DECLARE
  v_survey_id uuid;
BEGIN

  -- 1. Insert the survey
  INSERT INTO public.surveys (
    title,
    description,
    phase_number,
    target_role,
    rag_green_threshold,
    rag_amber_threshold,
    is_active,
    sort_order
  ) VALUES (
    'Phase 1 — Change Readiness Pulse',
    'A quick pulse check to understand how ready your organisation is for the upcoming change. Takes about 2 minutes to complete.',
    1,
    'cm',
    3.5,
    2.5,
    true,
    10
  )
  RETURNING id INTO v_survey_id;

  -- 2. Insert questions (all four types demonstrated)

  -- Q1: Rating — overall readiness
  INSERT INTO public.survey_questions (survey_id, question_text, question_type, is_required, sort_order)
  VALUES (v_survey_id,
    'How would you rate the overall readiness of your team for this change?',
    'rating', true, 10);

  -- Q2: Yes / No — leadership alignment
  INSERT INTO public.survey_questions (survey_id, question_text, question_type, is_required, sort_order)
  VALUES (v_survey_id,
    'Is senior leadership visibly supporting and championing this change?',
    'yes_no', true, 20);

  -- Q3: Single choice — biggest barrier
  INSERT INTO public.survey_questions (
    survey_id, question_text, question_type, options, is_required, sort_order
  ) VALUES (v_survey_id,
    'What is the biggest barrier to adoption in your area?',
    'single_choice',
    '[
      {"label": "Lack of awareness",         "score": 2},
      {"label": "Resistance to change",      "score": 1},
      {"label": "Insufficient training",     "score": 2},
      {"label": "Competing priorities",      "score": 3},
      {"label": "No major barriers",         "score": 5}
    ]'::jsonb,
    true, 30);

  -- Q4: Rating — communication clarity
  INSERT INTO public.survey_questions (survey_id, question_text, question_type, is_required, sort_order)
  VALUES (v_survey_id,
    'How clearly has the reason for this change been communicated to your team?',
    'rating', true, 40);

  -- Q5: Text — open feedback
  INSERT INTO public.survey_questions (survey_id, question_text, question_type, is_required, sort_order)
  VALUES (v_survey_id,
    'What one thing would most help your team get ready for this change?',
    'text', false, 50);

  RAISE NOTICE 'Sample survey created with id: %', v_survey_id;
END $$;

SELECT s.id, s.title, s.phase_number, s.target_role, count(q.id) AS question_count
FROM public.surveys s
LEFT JOIN public.survey_questions q ON q.survey_id = s.id
GROUP BY s.id, s.title, s.phase_number, s.target_role
ORDER BY s.created_at DESC
LIMIT 5;
