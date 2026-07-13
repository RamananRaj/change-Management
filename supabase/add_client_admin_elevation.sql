-- ChangeFlow: Client Admin elevation (no SQL needed to promote/demote)
-- Adds two Master-Admin-only paths to grant Client Admin:
--   1. A "Make Client Admin" toggle on an existing member (direct profiles update).
--   2. An "invite as Client Admin" checkbox — the invitee becomes a Client Admin
--      the moment they accept their invite.
-- Elevation stays a Master-Admin action (is_admin). Safe to re-run.

-- ─────────────────────────────────────────────────────────────
-- 1. Let Master Admins update any profile (needed to flip is_client_admin / client_id)
-- ─────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Admins update profiles" ON public.profiles;
CREATE POLICY "Admins update profiles" ON public.profiles FOR UPDATE
  USING      (public.is_admin())
  WITH CHECK (public.is_admin());

-- ─────────────────────────────────────────────────────────────
-- 2. Carry the elevation flag on invites
-- ─────────────────────────────────────────────────────────────
ALTER TABLE public.project_invites
  ADD COLUMN IF NOT EXISTS as_client_admin boolean DEFAULT false;

-- ─────────────────────────────────────────────────────────────
-- 3. accept_invite() also grants Client Admin when the invite says so
--    (unchanged behaviour otherwise — client_id, role, industry, onboarding).
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
        is_client_admin = CASE WHEN v_inv.as_client_admin THEN true ELSE is_client_admin END,
        onboarding_done = true
    WHERE id = auth.uid();

  UPDATE public.project_invites
    SET status = 'accepted', accepted_by = auth.uid(), accepted_at = now()
    WHERE id = v_inv.id;

  RETURN 'ok';
END;
$$;
GRANT EXECUTE ON FUNCTION public.accept_invite(uuid) TO authenticated;

SELECT 'client_admin elevation: profiles update policy + invite flag + accept_invite updated' AS result;
