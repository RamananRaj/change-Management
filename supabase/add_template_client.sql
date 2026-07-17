-- ChangeFlow · customer-only templates
-- Adds an optional client_id to templates. NULL = global (as today); set = belongs to one
-- customer, and only that customer's members (and admins) can see it. Enables the AI
-- "add this template for <customer>" flow. Uses public.my_client_id() / public.is_admin().
-- Safe to re-run.

ALTER TABLE public.templates
  ADD COLUMN IF NOT EXISTS client_id uuid REFERENCES public.clients(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS templates_client_idx ON public.templates (client_id);

-- Replace the "everyone reads all active templates" policy with a customer-scoped one:
-- members see global templates (client_id NULL) OR their own client's templates.
DROP POLICY IF EXISTS "Anyone authenticated can read active templates" ON public.templates;
CREATE POLICY "Read global or own-client templates" ON public.templates
  FOR SELECT
  USING (is_active = true AND auth.uid() IS NOT NULL
         AND (client_id IS NULL OR client_id = public.my_client_id()));

-- Master Admin manage-all + read-all already exist. Add: Client Admins manage their own
-- client's templates (so the AI flow works for them too, scoped to their client).
DROP POLICY IF EXISTS "Client admins manage their templates" ON public.templates;
CREATE POLICY "Client admins manage their templates" ON public.templates
  FOR ALL
  USING (public.is_client_admin() AND client_id = public.my_client_id())
  WITH CHECK (public.is_client_admin() AND client_id = public.my_client_id());

SELECT 'templates.client_id added + policies scoped' AS result;
