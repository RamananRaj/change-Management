-- ChangeFlow · ensure the service_role can read public tables.
-- The health-check Edge Function runs its table checks with the service role. Tables created via
-- the SQL editor didn't always carry the standard service_role grants, so server-side reads failed
-- ("permission denied"). This restores the normal Supabase behaviour. service_role is a server-only
-- key (never shipped to the browser) and already bypasses RLS, so this exposes nothing new.
-- Safe to re-run.

GRANT USAGE ON SCHEMA public TO service_role;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO service_role;

-- Cover tables created in future migrations too.
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO service_role;

SELECT 'service_role granted read on public' AS result;
