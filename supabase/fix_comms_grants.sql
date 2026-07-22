-- ChangeFlow: comms_items needs a table-level GRANT, not just RLS.
--
-- THE BUG A SCREENSHOT CAUGHT
--   The comms tab showed "permission denied for table comms_items" in the running app,
--   while every test and the SQL editor passed. The editor runs as the postgres
--   superuser, which bypasses grants; the browser runs as the `authenticated` role,
--   which does not.
--
--   RLS decides WHICH ROWS a role may see. A table-level GRANT decides whether the role
--   may touch the table AT ALL. They are two separate gates and both must be open. The
--   comms migration added the RLS policies but never granted table privileges to
--   `authenticated`, so the second gate stayed shut.
--
--   It surfaced specifically because comms_schedule is declared `security_invoker = on`
--   (it runs as the querying user, by design, so RLS applies). The older views run as
--   their definer and lean on the app filtering by client — which is exactly the weaker
--   pattern this view was trying NOT to copy. The stricter choice was right; it just
--   needed the grant to go with it.
--
-- Safe to re-run.

-- Row visibility is still governed entirely by the three RLS policies on comms_items
-- (admins all, client admins their client, members their projects). This GRANT only
-- opens the table to the role so those policies get a chance to run.
GRANT SELECT, INSERT, UPDATE, DELETE ON public.comms_items TO authenticated;

-- The schedule view is security_invoker, so the querying role reads the base tables
-- through it. comms_items is granted above; projects and project_milestones are already
-- readable by authenticated (the timeline has been reading them all along). Re-grant the
-- view select explicitly so a fresh database is complete.
GRANT SELECT ON public.comms_schedule TO authenticated;

-- ─────────────────────────────────────────────────────────────
-- Check: can the authenticated role now reach the table?
-- ─────────────────────────────────────────────────────────────
-- Lists the privileges the role holds on comms_items. Expect SELECT, INSERT, UPDATE,
-- DELETE. (This confirms the GRANT; RLS still filters rows at query time.)
SELECT grantee, privilege_type
FROM information_schema.role_table_grants
WHERE table_schema = 'public' AND table_name = 'comms_items' AND grantee = 'authenticated'
ORDER BY privilege_type;
