-- ChangeFlow · client-scopable content (+ promotable to the shared library)
-- Step 1: add client_id to phase_content (NULL = global/shared library; set = authored for one
-- client, but promotable back to global). This mirrors templates. This script only ADDS the
-- column (safe) and REPORTS phase_content's current RLS state, so we can scope reads correctly
-- in step 2 without accidentally hiding existing content. Safe to re-run.

ALTER TABLE public.phase_content
  ADD COLUMN IF NOT EXISTS client_id uuid REFERENCES public.clients(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS phase_content_client_idx ON public.phase_content (client_id);

-- Report the current row-level-security posture (so step 2 scopes safely):
SELECT c.relrowsecurity AS rls_enabled,
       (SELECT json_agg(policyname) FROM pg_policies WHERE tablename = 'phase_content') AS policies
FROM pg_class c WHERE c.relname = 'phase_content';
