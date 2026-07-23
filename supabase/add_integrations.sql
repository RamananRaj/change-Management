-- ChangeFlow: External Integrations — connect a client's Jira, pull the issues that
-- matter to change, and let CORA reason over them.
-- =============================================================================
-- WHAT THIS IS FOR
--   A client runs their delivery in Jira. The defects and issues that affect a
--   change programme are already there — they just aren't visible to the change
--   team. This lets a Master Admin connect a client's Jira and point a query at
--   whatever that client uses to mark change-relevant work.
--
-- FLEXIBLE BY DESIGN — A QUERY, NOT A HARD-CODED LABEL
--   Every Jira is set up differently. Rather than assume a fixed label, the
--   connection stores a JQL query. It defaults to  labels = Change_Management
--   but an admin can change it to anything — a different label, a project, an
--   issue type, a saved filter. The platform captures whatever the query returns;
--   it never dictates how the client tags their work.
--
-- PER CLIENT, NOT PLATFORM-WIDE
--   Each row is one client's connection. A client's Jira data stays scoped to that
--   client, the same isolation as the rest of their programme data.
--
-- THE TOKEN NEVER REACHES THE BROWSER
--   A Jira API token is a credential. It is written once by an admin and read only
--   server-side by the `jira` Edge Function (service role) when it calls Jira. The
--   UI reads a VIEW that omits the token entirely and exposes only whether one is
--   set. So the token is protected from anon, from other tenants, from members —
--   and is never shipped in a list response to the admin's own browser.
--
--   NOTE for production hardening: for defence-in-depth this token should move into
--   Supabase Vault (pgsodium) so it is encrypted at rest rather than stored as
--   plain text in an admin-only column. Flagged, not done — the RLS + safe-view
--   split already keeps it away from every untrusted party.
--
-- Safe to re-run.

-- ─────────────────────────────────────────────────────────────
-- 1. The table — one integration per client per provider
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.client_integrations (
  id            uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id     uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,

  provider      text NOT NULL DEFAULT 'jira' CHECK (provider IN ('jira')),

  -- Connection. base_url like https://acme.atlassian.net ; auth_email is the
  -- account the token belongs to.
  base_url      text CHECK (base_url IS NULL OR base_url ~ '^https://[^ ]+$'),
  auth_email    text CHECK (auth_email IS NULL OR length(auth_email) <= 160),
  api_token     text,                     -- server-side only; never selected by the UI

  -- The flexible bit: what counts as change-relevant, as a JQL query the admin owns.
  jql           text NOT NULL DEFAULT 'labels = Change_Management ORDER BY updated DESC'
                CHECK (length(jql) <= 2000),

  enabled       boolean NOT NULL DEFAULT false,

  -- Last connection test — so the UI can show a green/red without re-testing.
  last_tested_at timestamptz,
  last_test_ok   boolean,
  last_test_note text CHECK (last_test_note IS NULL OR length(last_test_note) <= 400),

  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),

  UNIQUE (client_id, provider)
);

CREATE INDEX IF NOT EXISTS idx_client_integrations_client ON public.client_integrations(client_id);

CREATE OR REPLACE FUNCTION public.client_integrations_touch()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END; $$;
DROP TRIGGER IF EXISTS client_integrations_touch_trg ON public.client_integrations;
CREATE TRIGGER client_integrations_touch_trg
  BEFORE UPDATE ON public.client_integrations
  FOR EACH ROW EXECUTE FUNCTION public.client_integrations_touch();

-- ─────────────────────────────────────────────────────────────
-- 2. RLS — Master Admin only
-- ─────────────────────────────────────────────────────────────
-- This lives under System Admin, so only platform admins manage it. No client-admin
-- or member policy — the credential and the connection are not theirs to see.
ALTER TABLE public.client_integrations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins manage integrations" ON public.client_integrations;
CREATE POLICY "Admins manage integrations" ON public.client_integrations
  FOR ALL TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());

-- Two gates: RLS (above) and the table GRANT (below). Both must be open. Omitting
-- the GRANT is what produced "permission denied for table comms_items" once.
-- REVOKE first so the Supabase defaults do not leave anon/authenticated with more
-- than intended (the same defaults that granted TRUNCATE on every table).
REVOKE ALL ON public.client_integrations FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.client_integrations TO authenticated;

-- ─────────────────────────────────────────────────────────────
-- 3. The safe view — everything the UI needs, minus the token
-- ─────────────────────────────────────────────────────────────
-- security_invoker so the base table's admin RLS still applies. The UI reads THIS,
-- never the base table, so the token is never shipped to the browser. `has_token`
-- lets the form show "connected" without ever handling the secret.
DROP VIEW IF EXISTS public.client_integrations_safe;
CREATE VIEW public.client_integrations_safe
  WITH (security_invoker = on) AS
SELECT
  ci.id, ci.client_id, c.name AS client_name,
  ci.provider, ci.base_url, ci.auth_email, ci.jql, ci.enabled,
  (ci.api_token IS NOT NULL AND length(ci.api_token) > 0) AS has_token,
  ci.last_tested_at, ci.last_test_ok, ci.last_test_note,
  ci.created_at, ci.updated_at
FROM public.client_integrations ci
JOIN public.clients c ON c.id = ci.client_id;

REVOKE ALL   ON public.client_integrations_safe FROM anon, authenticated;
GRANT SELECT ON public.client_integrations_safe TO authenticated;

-- ─────────────────────────────────────────────────────────────
-- 4. Checks
-- ─────────────────────────────────────────────────────────────
-- a) anon can touch neither the table nor the view; only authenticated (then RLS).
SELECT grantee, table_name, string_agg(privilege_type, ', ' ORDER BY privilege_type) AS privileges
FROM information_schema.role_table_grants
WHERE table_schema = 'public'
  AND table_name IN ('client_integrations','client_integrations_safe')
  AND grantee IN ('anon','authenticated')
GROUP BY grantee, table_name ORDER BY table_name, grantee;
-- Expect: no anon rows at all; authenticated → CRUD on the table, SELECT on the view.

-- b) the safe view must NOT expose api_token.
SELECT column_name
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'client_integrations_safe' AND column_name = 'api_token';
-- Expect: 0 rows.
