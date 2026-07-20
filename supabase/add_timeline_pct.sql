-- ChangeFlow: percent complete on timeline bands.
--
-- Bands draw a filled portion proportional to pct, the same way the ChangeFlow
-- phase bars already do — so a half-finished Build reads as half-finished at a
-- glance instead of looking identical to one that hasn't started.
--
-- Only project_milestones gets a column. Pathway ACTIVITIES deliberately do not:
-- their completion is already derived from user_activities (how many assigned
-- members have ticked the activity off). Giving them a hand-entered pct too would
-- create two numbers for the same fact with no way to tell which is right.
--
-- So: bands you invent by hand (Build, System Test) carry a manual pct;
--     bands that came from the pathway report real member progress.
--
-- Safe to re-run.

ALTER TABLE public.project_milestones
  ADD COLUMN IF NOT EXISTS pct int DEFAULT 0 CHECK (pct >= 0 AND pct <= 100);

SELECT 'timeline pct added' AS result;
