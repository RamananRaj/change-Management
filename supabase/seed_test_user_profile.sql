-- ChangeFlow: Seed Test User Profile
--
-- STEP 1: Before running this SQL, create the auth account in Supabase:
--   Supabase Dashboard → Authentication → Users → Add User
--   Email:    testuser@changeflow.com
--   Password: ChangeFlow2026!
--   (Tick "Auto Confirm User" so no email verification needed)
--
-- STEP 2: Copy the UUID shown for that user, paste it below as v_user_id
-- STEP 3: Run this SQL

DO $$
DECLARE
  v_user_id uuid := 'PASTE-AUTH-USER-UUID-HERE';  -- ← replace this
BEGIN

  INSERT INTO public.profiles (
    id,
    full_name,
    role,
    industry,
    is_admin,
    created_at
  ) VALUES (
    v_user_id,
    'Test User',
    'po',                    -- Product Owner role — different from Ujwal (cm)
    'utilities-energy',      -- same industry so content overlaps
    false,
    now()
  )
  ON CONFLICT (id) DO UPDATE SET
    full_name = EXCLUDED.full_name,
    role      = EXCLUDED.role,
    industry  = EXCLUDED.industry,
    is_admin  = EXCLUDED.is_admin;

  -- Create a project + unlock Phase 1 for this user
  WITH ins AS (
    INSERT INTO public.projects (user_id, name, created_at)
    VALUES (v_user_id, 'Test Project', now())
    RETURNING id
  )
  INSERT INTO public.project_phases (project_id, phase_number, status)
  SELECT ins.id, 1, 'active' FROM ins;

  RAISE NOTICE 'Test User profile created for %', v_user_id;
END $$;

-- Verify
SELECT p.id, p.full_name, p.role, p.industry, p.is_admin,
       pp.phase_number, pp.status
FROM public.profiles p
LEFT JOIN public.projects proj ON proj.user_id = p.id
LEFT JOIN public.project_phases pp ON pp.project_id = proj.id
WHERE p.full_name = 'Test User';
