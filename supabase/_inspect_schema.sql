-- Only the columns that can break an INSERT: NOT NULL with no default.
-- These are the ones the seed must supply a value for.
SELECT table_name || '.' || column_name || '  (' || data_type || ')' AS must_supply
FROM information_schema.columns
WHERE table_schema = 'public'
  AND is_nullable = 'NO'
  AND column_default IS NULL
  AND table_name IN (
    'projects', 'project_phases', 'project_members', 'phase_content',
    'templates', 'stakeholders', 'surveys', 'survey_questions',
    'user_activities', 'progress_snapshots', 'project_pathways',
    'project_lanes', 'project_milestones', 'clients'
  )
ORDER BY table_name, ordinal_position;
