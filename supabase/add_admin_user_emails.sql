-- ChangeFlow: expose auth email to Master Admins for the System Admin user table.
-- profiles has no email column (it lives in auth.users, which the client can't read
-- directly). This SECURITY DEFINER function returns id+email ONLY when the caller is
-- a Master Admin. Safe to re-run.

CREATE OR REPLACE FUNCTION public.admin_user_emails()
RETURNS TABLE (id uuid, email text)
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT u.id, u.email::text
  FROM auth.users u
  WHERE public.is_admin();     -- returns rows only for Master Admins, else empty
$$;

GRANT EXECUTE ON FUNCTION public.admin_user_emails() TO authenticated;

SELECT 'admin_user_emails() created' AS result;
