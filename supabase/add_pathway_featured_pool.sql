-- ChangeFlow: Phase Pathway, Featured flag, and Question Pool
-- Run this in Supabase SQL Editor

-- 1. Add pathway_step and is_featured to phase_content
--    pathway_step: NULL = not in pathway, 1–5 = step number in the admin-defined path
--    is_featured:  true = appears highlighted at top of the regular tab list
ALTER TABLE public.phase_content
  ADD COLUMN IF NOT EXISTS pathway_step int DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS is_featured  boolean DEFAULT false;

-- 2. Add is_active to survey_questions (question pool)
--    true (default) = shown to users in survey
--    false = in the admin pool but not currently active
ALTER TABLE public.survey_questions
  ADD COLUMN IF NOT EXISTS is_active boolean DEFAULT true;

-- Verify
SELECT
  column_name, data_type, column_default
FROM information_schema.columns
WHERE table_name IN ('phase_content', 'survey_questions')
  AND column_name IN ('pathway_step', 'is_featured', 'is_active')
ORDER BY table_name, column_name;
