-- ChangeFlow · client-scopable content — Step 2: scope reads + let client admins author.
--
-- Prereq: run add_content_client.sql first (adds phase_content.client_id).
-- Current policies were: "Admins manage phase content" (platform admins manage all)
-- and "Users can read phase content" (everyone reads everything). We tighten the read
-- policy so client-specific rows are private to that client, while GLOBAL rows
-- (client_id IS NULL) stay readable by all — every existing row is global, so nothing
-- is hidden. Safe to re-run.

-- 1) Scoped read: global content OR your own client's content OR you're a platform admin.
DROP POLICY IF EXISTS "Users can read phase content" ON public.phase_content;
CREATE POLICY "Read phase content (global or own client)"
  ON public.phase_content FOR SELECT
  TO authenticated
  USING (
    client_id IS NULL
    OR client_id = public.my_client_id()
    OR public.is_admin()
  );

-- 2) Client admins may author/manage content for their OWN client only.
--    (Platform admins keep the existing "Admins manage phase content" policy, which
--     covers global content + promoting client content back to the shared library.)
DROP POLICY IF EXISTS "Client admins manage own client content" ON public.phase_content;
CREATE POLICY "Client admins manage own client content"
  ON public.phase_content FOR ALL
  TO authenticated
  USING (public.is_client_admin() AND client_id = public.my_client_id())
  WITH CHECK (public.is_client_admin() AND client_id = public.my_client_id());

-- Report the resulting posture.
SELECT (SELECT json_agg(policyname) FROM pg_policies WHERE tablename = 'phase_content') AS policies;
