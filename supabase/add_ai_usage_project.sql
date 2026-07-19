-- ChangeFlow · attribute AI usage to a project (client_id already exists on ai_usage).
-- Lets the System Admin "AI Usage" tab break usage down by client AND by project.
-- Safe to re-run.

ALTER TABLE public.ai_usage
  ADD COLUMN IF NOT EXISTS project_id uuid REFERENCES public.projects(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS ai_usage_project_idx ON public.ai_usage (project_id);

-- RLS is unchanged: the existing INSERT policy (user_id = auth.uid()) still applies, and the
-- existing SELECT policy (Master Admin all / Client Admin own client) already governs reads.

SELECT 'ai_usage.project_id added' AS result;
