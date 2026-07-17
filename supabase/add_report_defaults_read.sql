-- ChangeFlow · platform report defaults (cross-client learning, done safely)
-- A change_artifacts row with client_id IS NULL and type 'report_defaults' is the platform
-- STANDARD narrative — client-agnostic. Every client's report inherits it unless that client
-- has its own saved edit (which always wins). These defaults are generic (no client data), so
-- all authenticated users may read them. Only Master Admin may write them (the existing
-- "Manage change artifacts" policy already allows is_admin() on any row, incl. client_id NULL).
-- Safe to re-run.

DROP POLICY IF EXISTS "Read global artifacts" ON public.change_artifacts;
CREATE POLICY "Read global artifacts" ON public.change_artifacts
  FOR SELECT USING (client_id IS NULL AND auth.uid() IS NOT NULL);

SELECT 'global change_artifacts readable by authenticated' AS result;
