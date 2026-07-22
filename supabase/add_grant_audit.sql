-- ChangeFlow: make over-granted privileges fail a health check, not wait for an audit.
-- =============================================================================
-- WHY THIS EXISTS
--   Three privilege bugs have now been found in this codebase by hand:
--     1. comms_items had RLS but no GRANT      → the app broke loudly. Easy to find.
--     2. leads had a GRANT that was too broad  → nothing broke. Found by a check query.
--     3. anon held TRUNCATE on all 54 tables   → nothing broke. Found by the same query.
--
--   Cases 2 and 3 are the dangerous shape: everything works, no test fails, no screen
--   errors. They are only visible if someone goes looking. Relying on someone
--   remembering to look is not a control.
--
--   This turns "someone should check the grants" into a check that runs every time the
--   health check runs, and shows up red in System Health when it drifts.
--
-- HOW IT DECIDES
--   An ALLOWLIST, not a blocklist. Anything the public roles hold that is not
--   explicitly expected is reported. A blocklist would only ever catch the specific
--   mistakes we already know about — which is exactly how case 3 survived so long.
--
-- RLS DOES NOT COVER EVERYTHING
--   TRUNCATE is not subject to row-level security. Neither is REFERENCES or TRIGGER.
--   No policy, however carefully written, protects against them — so they must not be
--   granted to a public role at all.
--
-- Safe to re-run.

-- ─────────────────────────────────────────────────────────────
-- 1. The audit function
-- ─────────────────────────────────────────────────────────────
-- SECURITY DEFINER because information_schema shows the caller only what the caller
-- can see; we need the full picture regardless of who asks. It returns findings only
-- — never data — so it leaks nothing beyond the shape of the schema.
CREATE OR REPLACE FUNCTION public.audit_public_grants()
RETURNS TABLE (grantee text, object_name text, privileges text, problem text)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
  WITH g AS (
    SELECT rtg.grantee::text     AS grantee,
           rtg.table_name::text  AS object_name,
           rtg.privilege_type::text AS priv
    FROM information_schema.role_table_grants rtg
    WHERE rtg.table_schema = 'public'
      AND rtg.grantee IN ('anon', 'authenticated')
  ),
  flagged AS (
    SELECT g.grantee, g.object_name, g.priv,
      CASE
        -- Not governed by RLS at all. Never acceptable for a public role.
        WHEN g.priv IN ('TRUNCATE','REFERENCES','TRIGGER')
          THEN 'not covered by RLS — a policy cannot stop this'

        -- anon is the unauthenticated browser key. It ships in the bundle, so treat
        -- every privilege it holds as public knowledge.
        WHEN g.grantee = 'anon' AND g.priv IN ('UPDATE','DELETE')
          THEN 'anon can modify or remove rows'

        -- The ONLY table the public may write to is the lead capture form.
        WHEN g.grantee = 'anon' AND g.priv = 'INSERT' AND g.object_name <> 'leads'
          THEN 'anon can write to a table other than leads'

        -- Publicly readable tables, deliberately. `industries` feeds the signup
        -- picker before login. Add to this list only with a reason.
        WHEN g.grantee = 'anon' AND g.priv = 'SELECT' AND g.object_name NOT IN ('industries')
          THEN 'anon can read this table'

        ELSE NULL
      END AS problem
    FROM g
  )
  SELECT grantee, object_name,
         string_agg(priv, ', ' ORDER BY priv) AS privileges,
         problem
  FROM flagged
  WHERE problem IS NOT NULL
  GROUP BY grantee, object_name, problem
  ORDER BY grantee, object_name;
$$;

-- The function is a diagnostic, not data. Admins and the service role may run it.
REVOKE ALL     ON FUNCTION public.audit_public_grants() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.audit_public_grants() TO authenticated, service_role;

COMMENT ON FUNCTION public.audit_public_grants() IS
  'Lists privileges held by anon/authenticated in public that are not on the allowlist. Empty = healthy. Called by the health-check function.';

-- ─────────────────────────────────────────────────────────────
-- 2. Check — this must return zero rows
-- ─────────────────────────────────────────────────────────────
SELECT * FROM public.audit_public_grants();
-- Any row here is a finding. `problem` says why it matters.
--
-- If a row is legitimate (a table you have deliberately made public), add it to the
-- allowlist in the function above rather than ignoring the output. An audit that is
-- expected to return noise is an audit nobody reads.
