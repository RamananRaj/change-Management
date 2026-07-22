-- ChangeFlow: lock the leads table down to INSERT-only for anon.
-- =============================================================================
-- THE BUG THIS FIXES
--   After running add_leads.sql, the privilege check returned:
--
--       anon           INSERT, REFERENCES, TRIGGER, TRUNCATE
--       authenticated  DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE
--
--   anon was supposed to hold INSERT and nothing else. It also held TRUNCATE.
--
-- WHY TRUNCATE MATTERS MORE THAN IT LOOKS
--   The anon key ships inside the browser bundle — it is public by design. So
--   "anon may TRUNCATE public.leads" means anyone who opens devtools can delete
--   every lead in the table with one statement.
--
--   And RLS does not save us here. PostgreSQL does not apply row security policies
--   to TRUNCATE — it is a table-level operation, so `USING (public.is_admin())`
--   is simply not consulted. The careful RLS on this table offers zero protection
--   against the one privilege that can empty it.
--
-- WHERE IT CAME FROM
--   Not from add_leads.sql. Supabase's default privileges hand a set of rights to
--   anon and authenticated on new tables in `public`, and a GRANT can only ever ADD
--   to what a role already holds — it never restricts. Writing `GRANT INSERT ... TO
--   anon` and assuming that means "INSERT only" is the mistake. To get "only", you
--   have to REVOKE first.
--
--   This is the same shape as the comms_items bug, inverted. There, RLS was right
--   and the GRANT was missing, so nothing worked. Here, RLS is right and the GRANT
--   is too generous, so too much works. Both cases: RLS and GRANT are separate gates
--   and checking one tells you nothing about the other.
--
-- Safe to re-run.

-- ─────────────────────────────────────────────────────────────
-- 1. Strip everything, then grant back exactly what is needed
-- ─────────────────────────────────────────────────────────────
REVOKE ALL ON public.leads FROM anon;
REVOKE ALL ON public.leads FROM authenticated;

-- anon: submit a lead. That is the entire public surface of this table.
-- No SELECT (cannot read the pipeline back, not even their own row).
-- No UPDATE/DELETE/TRUNCATE (cannot alter or destroy anything).
GRANT INSERT ON public.leads TO anon;

-- authenticated: full CRUD, with RLS then restricting rows to Master Admins only.
-- Still no TRUNCATE — there is no reason for the app to empty this table, and
-- leaving it out means no bug in the app can either.
GRANT SELECT, INSERT, UPDATE, DELETE ON public.leads TO authenticated;

-- The view is read-only and security_invoker, so it inherits the base table's RLS.
REVOKE ALL ON public.lead_pipeline FROM anon, authenticated;
GRANT SELECT ON public.lead_pipeline TO authenticated;

-- ─────────────────────────────────────────────────────────────
-- 2. Confirm
-- ─────────────────────────────────────────────────────────────
SELECT grantee, string_agg(privilege_type, ', ' ORDER BY privilege_type) AS privileges
FROM information_schema.role_table_grants
WHERE table_schema = 'public' AND table_name = 'leads' AND grantee IN ('anon','authenticated')
GROUP BY grantee ORDER BY grantee;
-- Expect EXACTLY:
--   anon           INSERT
--   authenticated  DELETE, INSERT, SELECT, UPDATE

-- ─────────────────────────────────────────────────────────────
-- 3. The wider question this raises — READ THIS
-- ─────────────────────────────────────────────────────────────
-- If the defaults handed TRUNCATE to anon on `leads`, they may have done the same
-- on every other table in `public`. Every one of those is protected by RLS for
-- SELECT/INSERT/UPDATE/DELETE — and by nothing at all for TRUNCATE.
--
-- This lists every table anon can destroy or modify. Anything that comes back is
-- worth a decision, not a shrug.
SELECT table_name,
       string_agg(privilege_type, ', ' ORDER BY privilege_type) AS anon_can
FROM information_schema.role_table_grants
WHERE table_schema = 'public'
  AND grantee = 'anon'
  AND privilege_type IN ('TRUNCATE','DELETE','UPDATE','INSERT')
GROUP BY table_name
ORDER BY table_name;

-- If that list is long, the blanket fix is below — it removes destructive rights
-- from anon across the whole schema while leaving SELECT/INSERT alone, so RLS
-- continues to do its job on the operations it actually governs.
--
-- Left commented deliberately: read the list above first and be sure nothing in
-- the app relies on anonymous writes, then run it knowingly.
--
--   DO $$
--   DECLARE t record;
--   BEGIN
--     FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' LOOP
--       EXECUTE format('REVOKE TRUNCATE, DELETE, UPDATE ON public.%I FROM anon', t.tablename);
--     END LOOP;
--   END $$;
--
--   -- and stop new tables inheriting the same:
--   ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE TRUNCATE, DELETE, UPDATE ON TABLES FROM anon;
