-- ChangeFlow: richer user metadata for the System Admin / Client Admin user tables.
-- Returns email + ban state + last sign-in, scoped to what the caller may see:
--   • Master Admin (is_admin)        → all users.
--   • Client Admin (is_client_admin) → only users in their own client.
-- Safe to re-run.

CREATE OR REPLACE FUNCTION public.admin_user_meta()
RETURNS TABLE (id uuid, email text, banned_until timestamptz, last_sign_in_at timestamptz)
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT u.id, u.email::text, u.banned_until, u.last_sign_in_at
  FROM auth.users u
  WHERE public.is_admin()
     OR (public.is_client_admin() AND EXISTS (
           SELECT 1 FROM public.profiles p
           WHERE p.id = u.id AND p.client_id = public.my_client_id()));
$$;

GRANT EXECUTE ON FUNCTION public.admin_user_meta() TO authenticated;

SELECT 'admin_user_meta() updated (master + client-admin scoped)' AS result;
