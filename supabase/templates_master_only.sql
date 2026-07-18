-- ChangeFlow · make Templates Master-Admin-controlled (match the phase_content rule).
-- Client Admins should NOT author templates — only consume. Platform admins keep full control
-- via the existing "Admins manage" policy; the scoped READ policy stays so clients still see
-- global + their own templates.
--
-- Step 1: show the current templates policies so we drop exactly the client-admin WRITE one.
SELECT (SELECT json_agg(policyname) FROM pg_policies WHERE tablename = 'templates') AS policies;

-- Step 2 (run after checking the list): drop the client-admin manage policy.
-- The name added earlier was likely one of these — uncomment the matching line:
-- DROP POLICY IF EXISTS "Client admins manage own client templates" ON public.templates;
-- DROP POLICY IF EXISTS "Client admins manage own templates"        ON public.templates;
