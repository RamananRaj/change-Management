-- ChangeFlow: Client (multi-tenant) schema
-- clients           = organisations / companies using ChangeFlow
-- client_pathways   = per-client curated pathway steps per phase
-- profiles.client_id = links a user to their client
-- Safe to re-run: uses IF NOT EXISTS + DROP POLICY IF EXISTS guards.

-- ─────────────────────────────────────────────────────────────
-- 1. Clients table
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.clients (
  id            uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  name          text NOT NULL,
  industry      text,
  contact_name  text,
  contact_email text,
  notes         text,
  is_active     boolean DEFAULT true,
  created_at    timestamptz DEFAULT now()
);

ALTER TABLE public.clients ENABLE ROW LEVEL SECURITY;

-- ─────────────────────────────────────────────────────────────
-- 2. Add client_id to profiles
--    (must come BEFORE any policy that references profiles.client_id)
-- ─────────────────────────────────────────────────────────────
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS client_id uuid REFERENCES public.clients(id) ON DELETE SET NULL;

-- ─────────────────────────────────────────────────────────────
-- 3. Clients policies
-- ─────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Admins manage clients" ON public.clients;
CREATE POLICY "Admins manage clients"
  ON public.clients FOR ALL
  USING   (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND is_admin = true))
  WITH CHECK (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND is_admin = true));

-- Users can read their own client record
DROP POLICY IF EXISTS "Users read own client" ON public.clients;
CREATE POLICY "Users read own client"
  ON public.clients FOR SELECT
  USING (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND client_id = public.clients.id));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.clients TO authenticated;

-- ─────────────────────────────────────────────────────────────
-- 4. Client Pathways table
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.client_pathways (
  id           uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id    uuid REFERENCES public.clients(id) ON DELETE CASCADE NOT NULL,
  phase_number int NOT NULL,
  content_id   uuid REFERENCES public.phase_content(id) ON DELETE CASCADE NOT NULL,
  pathway_step int NOT NULL,
  created_at   timestamptz DEFAULT now(),
  UNIQUE (client_id, phase_number, pathway_step)
);

ALTER TABLE public.client_pathways ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins manage client pathways" ON public.client_pathways;
CREATE POLICY "Admins manage client pathways"
  ON public.client_pathways FOR ALL
  USING   (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND is_admin = true))
  WITH CHECK (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND is_admin = true));

-- Users can read their client's pathway
DROP POLICY IF EXISTS "Users read own client pathway" ON public.client_pathways;
CREATE POLICY "Users read own client pathway"
  ON public.client_pathways FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND client_id = public.client_pathways.client_id
  ));

GRANT SELECT ON public.client_pathways TO authenticated;
GRANT INSERT, UPDATE, DELETE ON public.client_pathways TO authenticated;

-- ─────────────────────────────────────────────────────────────
-- Verify
-- ─────────────────────────────────────────────────────────────
SELECT 'clients, client_pathways created; client_id added to profiles' AS result;
