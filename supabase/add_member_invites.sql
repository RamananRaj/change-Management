-- ChangeFlow: Admin-created member invites (no email server required)
-- An admin creates an invite for a person (by email) on a project. The app turns
-- it into a shareable /signup?invite=<token> link. When that person registers,
-- accept_invite() links them to the client + project, sets their role, inherits
-- the client's industry, and marks onboarding complete.
-- Safe to re-run.

-- ─────────────────────────────────────────────────────────────
-- 1. project_invites table
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.project_invites (
  id          uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  token       uuid DEFAULT gen_random_uuid() UNIQUE NOT NULL,
  project_id  uuid REFERENCES public.projects(id) ON DELETE CASCADE NOT NULL,
  client_id   uuid REFERENCES public.clients(id)  ON DELETE CASCADE NOT NULL,
  email       text NOT NULL,
  full_name   text,
  role        text,
  status      text DEFAULT 'pending' CHECK (status IN ('pending','accepted','revoked')),
  invited_by  uuid REFERENCES auth.users(id),
  accepted_by uuid REFERENCES auth.users(id),
  accepted_at timestamptz,
  created_at  timestamptz DEFAULT now()
);

ALTER TABLE public.project_invites ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins manage invites" ON public.project_invites;
CREATE POLICY "Admins manage invites"
  ON public.project_invites FOR ALL
  USING   (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND is_admin = true))
  WITH CHECK (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND is_admin = true));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.project_invites TO authenticated;

-- ─────────────────────────────────────────────────────────────
-- 2. invite_details(token) — used to prefill the signup page.
--    Callable by anon (the invitee isn't logged in yet). Returns only safe fields.
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.invite_details(p_token uuid)
RETURNS TABLE (email text, full_name text, client_name text, project_name text, status text)
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT i.email, i.full_name, c.name AS client_name, p.name AS project_name, i.status
  FROM public.project_invites i
  JOIN public.clients  c ON c.id = i.client_id
  JOIN public.projects p ON p.id = i.project_id
  WHERE i.token = p_token;
$$;
GRANT EXECUTE ON FUNCTION public.invite_details(uuid) TO anon, authenticated;

-- ─────────────────────────────────────────────────────────────
-- 3. accept_invite(token) — links the current authenticated user.
--    Validates that the signed-in user's email matches the invite.
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.accept_invite(p_token uuid)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_inv      public.project_invites%ROWTYPE;
  v_email    text;
  v_industry text;
BEGIN
  SELECT * INTO v_inv FROM public.project_invites WHERE token = p_token AND status = 'pending';
  IF NOT FOUND THEN RETURN 'invalid_or_used'; END IF;

  SELECT email INTO v_email FROM auth.users WHERE id = auth.uid();
  IF v_email IS NULL OR lower(v_email) <> lower(v_inv.email) THEN
    RETURN 'email_mismatch';
  END IF;

  SELECT industry INTO v_industry FROM public.clients WHERE id = v_inv.client_id;

  INSERT INTO public.project_members (project_id, user_id)
    VALUES (v_inv.project_id, auth.uid())
    ON CONFLICT (project_id, user_id) DO NOTHING;

  UPDATE public.profiles
    SET client_id       = v_inv.client_id,
        role            = COALESCE(v_inv.role, role),
        industry        = COALESCE(v_industry, industry),
        onboarding_done = true
    WHERE id = auth.uid();

  UPDATE public.project_invites
    SET status = 'accepted', accepted_by = auth.uid(), accepted_at = now()
    WHERE id = v_inv.id;

  RETURN 'ok';
END;
$$;
GRANT EXECUTE ON FUNCTION public.accept_invite(uuid) TO authenticated;

SELECT 'project_invites + invite_details + accept_invite created' AS result;
