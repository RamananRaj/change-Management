-- ChangeFlow · make CORA's knowledge layer fully data-driven.
--
-- Previously the four disciplines were hardcoded in the app (which phrases match, what data is
-- missing). Now each RULE declares that itself:
--   triggers — phrases that route a question to this rule
--   gaps     — what ChangeFlow does not hold for this subject, quoted in the honesty note
--
-- Adding a whole new subject (benefits realisation, resistance management, hypercare…) is now an
-- INSERT, not a code change. Safe to re-run.

ALTER TABLE public.ai_knowledge ADD COLUMN IF NOT EXISTS triggers text[];
ALTER TABLE public.ai_knowledge ADD COLUMN IF NOT EXISTS gaps     text[];

CREATE INDEX IF NOT EXISTS ai_knowledge_triggers_idx ON public.ai_knowledge USING gin (triggers);

-- Backfill the seeded disciplines.
UPDATE public.ai_knowledge SET
  triggers = ARRAY['comms','communication','communications'],
  gaps = ARRAY[
    'a key-message library or comms calendar',
    'audience channel preferences (what each group actually reads)',
    'a sponsor engagement roadmap']
WHERE topic = 'comms' AND triggers IS NULL;

UPDATE public.ai_knowledge SET
  triggers = ARRAY['training','learning','upskill'],
  gaps = ARRAY[
    'a training needs analysis - what each role does today, what changes, and the capability gap',
    'a curriculum or course list mapped to roles',
    'trainer availability and delivery capacity',
    'completion or assessment data']
WHERE topic = 'training' AND triggers IS NULL;

UPDATE public.ai_knowledge SET
  triggers = ARRAY['cutover','go-live','go live','golive','deployment'],
  gaps = ARRAY[
    'a cutover runbook with sequenced tasks and durations',
    'agreed go/no-go criteria and rollback triggers',
    'environment, data-migration and support-model detail']
WHERE topic = 'cutover' AND triggers IS NULL;

UPDATE public.ai_knowledge SET
  triggers = ARRAY['train the trainer','train-the-trainer','trainer the trainer','ttt','cascade'],
  gaps = ARRAY[
    'trainer nominations and their current capability',
    'cascade capacity - how many sessions each trainer can realistically run',
    'a trainer pack and certification standard']
WHERE topic = 'ttt' AND triggers IS NULL;

SELECT 'ai_knowledge triggers + gaps added' AS result;
