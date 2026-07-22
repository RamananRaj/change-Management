-- ChangeFlow: remove TRUNCATE from anon and authenticated across the schema.
-- =============================================================================
-- SEVERITY: high. Run this before anything else on the list.
--
-- WHAT WAS FOUND
--   A privilege audit after adding the leads table returned 54 rows — every table
--   in `public` — with TRUNCATE granted to `anon`:
--
--       ai_usage, audiences, change_artifacts, chat_channels, chat_members,
--       chat_messages, clients, comms_items, projects, project_phases, … 54 in all
--
-- WHY THIS MATTERS
--   1. The `anon` key is PUBLIC. It ships inside the browser bundle; that is what it
--      is for. Anyone who opens devtools on the marketing page or the app has it.
--   2. PostgreSQL does NOT apply row-level security to TRUNCATE. RLS governs SELECT,
--      INSERT, UPDATE and DELETE. TRUNCATE is a table-level operation and policies
--      are never consulted.
--
--   Together: any visitor could have emptied `clients`, `chat_messages`, `audiences`
--   or any other table, and every RLS policy in the platform would have watched it
--   happen without objecting. The isolation model is genuinely well built — it just
--   does not cover this verb.
--
-- WHY IT WAS INVISIBLE
--   Nothing breaks. The app never truncates, so no test fails and no screen errors.
--   It only shows up if you go looking at privileges directly — which is why the
--   check query at the end of a migration earned its place today.
--
-- WHERE IT CAME FROM
--   Supabase's default privileges on new tables in `public`. Not from application
--   code. Note the shape of the mistake: a GRANT can only ADD to what a role holds.
--   Writing `GRANT INSERT ... TO anon` and reading it as "anon gets INSERT only" is
--   wrong — to mean "only", you must REVOKE first.
--
-- WHAT THIS CHANGES FOR THE RUNNING APP
--   Nothing. The application never issues TRUNCATE, never defines foreign keys at
--   runtime (REFERENCES) and never creates triggers from the client (TRIGGER). These
--   three privileges are pure downside for both roles. SELECT/INSERT/UPDATE/DELETE
--   are untouched, so RLS continues to govern everything it already governed.
--
-- Safe to re-run.

-- ─────────────────────────────────────────────────────────────
-- 1. Strip the destructive and schema-level verbs from every existing table
-- ─────────────────────────────────────────────────────────────
-- `authenticated` is included deliberately. Those are real signed-in people —
-- client admins and members in customer organisations. None of them should be able
-- to empty a table either, and a compromised or curious account is a likelier
-- attacker than a passing stranger.
DO $$
DECLARE t record;
BEGIN
  FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' LOOP
    EXECUTE format('REVOKE TRUNCATE, REFERENCES, TRIGGER ON public.%I FROM anon', t.tablename);
    EXECUTE format('REVOKE TRUNCATE, REFERENCES, TRIGGER ON public.%I FROM authenticated', t.tablename);
  END LOOP;
END $$;

-- Views too. pg_tables excludes them, so the first pass left TRUNCATE recorded on
-- comms_schedule, training_coverage, training_demand and project_phase_scope.
--
-- Those grants are INERT — PostgreSQL will not truncate a view; TRUNCATE only accepts
-- tables, so the privilege can never be exercised. They are cleared anyway so that
-- the audit query below returns genuinely empty. An audit that always shows four
-- "harmless" rows is an audit people stop reading, and the next real finding hides
-- among them.
DO $$
DECLARE v record;
BEGIN
  FOR v IN SELECT viewname FROM pg_views WHERE schemaname = 'public' LOOP
    EXECUTE format('REVOKE TRUNCATE, REFERENCES, TRIGGER ON public.%I FROM anon', v.viewname);
    EXECUTE format('REVOKE TRUNCATE, REFERENCES, TRIGGER ON public.%I FROM authenticated', v.viewname);
  END LOOP;
END $$;

-- ─────────────────────────────────────────────────────────────
-- 2. Stop new tables inheriting the same thing
-- ─────────────────────────────────────────────────────────────
-- Without this, the next CREATE TABLE reopens the hole and the next audit finds it
-- again. Applies to objects created by the roles that run migrations.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  REVOKE TRUNCATE, REFERENCES, TRIGGER ON TABLES FROM anon;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  REVOKE TRUNCATE, REFERENCES, TRIGGER ON TABLES FROM authenticated;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE TRUNCATE, REFERENCES, TRIGGER ON TABLES FROM anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE TRUNCATE, REFERENCES, TRIGGER ON TABLES FROM authenticated;

-- ─────────────────────────────────────────────────────────────
-- 3. Confirm — both of these must come back EMPTY
-- ─────────────────────────────────────────────────────────────
-- a) Nobody public can destroy a table any more.
SELECT grantee, table_name, privilege_type
FROM information_schema.role_table_grants
WHERE table_schema = 'public'
  AND grantee IN ('anon','authenticated')
  AND privilege_type IN ('TRUNCATE','REFERENCES','TRIGGER')
ORDER BY grantee, table_name;
-- Expect: 0 rows.

-- b) anon can still only write to the one table that needs it, and read nothing.
SELECT table_name, string_agg(privilege_type, ', ' ORDER BY privilege_type) AS anon_can
FROM information_schema.role_table_grants
WHERE table_schema = 'public' AND grantee = 'anon'
GROUP BY table_name
ORDER BY table_name;
-- Expect: `leads → INSERT`, plus any table you have deliberately made publicly
-- readable. If anything unexpected has SELECT, that is a confidentiality question
-- worth answering separately.

-- ─────────────────────────────────────────────────────────────
-- 4. What this does NOT fix
-- ─────────────────────────────────────────────────────────────
-- Two older views — `training_coverage` and `project_phase_scope` — were created
-- without `security_invoker = on`, so they run with their definer's rights and lean
-- on the application always filtering by client. That is a separate, still-open
-- multi-tenant gap, flagged previously and not addressed here. Worth retrofitting
-- the flag the same way `comms_schedule` and `lead_pipeline` already have it.
