-- ChangeFlow: let admins read ALL profiles.
-- Needed so the admin can list every user and resolve project members.
-- A SECURITY DEFINER helper avoids recursive RLS on the profiles table
-- (a policy on profiles that queries profiles directly would loop).
-- Safe to re-run.

CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND is_admin = true);
$$;
GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated;

-- Permissive SELECT policy — combines with the existing "users read own" via OR.
DROP POLICY IF EXISTS "Admins read all profiles" ON public.profiles;
CREATE POLICY "Admins read all profiles"
  ON public.profiles FOR SELECT
  USING (public.is_admin());

SELECT 'admin profile read policy added' AS result;
