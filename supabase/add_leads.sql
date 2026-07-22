-- ChangeFlow: leads and opportunities — the pipeline in front of a client.
-- =============================================================================
-- WHAT THIS IS FOR
--   Someone fills in "Book a demo" on the marketing site, or Ram meets a change
--   manager at an ACMP chapter night. Both are the same thing: a person who might
--   become a client. This table is where they land and where they are worked until
--   they either become a client or don't.
--
-- ONE ROW, ONE TOGGLE
--   A "lead" and an "opportunity" are the same record before and after someone
--   decides it is worth real time. So there is no separate table and no stage
--   ladder — just a flag you flip:
--
--       is_opportunity = false   →  Leads          (came in, not yet judged)
--       is_opportunity = true    →  Opportunities  (worth working)
--       status = won | lost      →  Closed          (out of both lists)
--
--   A longer stage pipeline (contacted → qualified → proposal → …) was considered
--   and rejected. With no customers yet, stages nobody actually moves through just
--   go stale, and a pipeline that reports a stage nobody maintains is worse than no
--   pipeline at all. Two booleans and a status are the amount of structure that can
--   be kept true. Add stages later if the volume ever justifies them.
--
-- THE ONE PUBLIC WRITE IN THE WHOLE PLATFORM
--   Every other table here is written only by an authenticated user. This one takes
--   INSERT from `anon`, because the point is that a stranger on the marketing site
--   can reach it. So:
--       · anon may INSERT and nothing else — no SELECT, so a submitter cannot read
--         back anyone's lead, not even their own.
--       · length caps on every free-text field, or the table becomes free storage
--         for whoever finds the endpoint.
--       · a honeypot flag: the form carries a hidden field no human ever fills.
--         Rows arriving with it set are marked spam rather than rejected, because a
--         bot told "no" simply tries again.
--
-- Safe to re-run.

-- ─────────────────────────────────────────────────────────────
-- 1. The table
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.leads (
  id              uuid DEFAULT gen_random_uuid() PRIMARY KEY,

  -- ── Who ──────────────────────────────────────────────────────────────────
  full_name       text NOT NULL CHECK (length(full_name) BETWEEN 1 AND 120),
  email           text NOT NULL CHECK (length(email)     BETWEEN 3 AND 160),
  organisation    text          CHECK (organisation IS NULL OR length(organisation) <= 160),
  role            text          CHECK (role         IS NULL OR length(role) <= 80),
  phone           text          CHECK (phone        IS NULL OR length(phone) <= 40),

  -- ── What they told us ────────────────────────────────────────────────────
  programme_size  text          CHECK (programme_size IS NULL OR length(programme_size) <= 60),
  timeframe       text          CHECK (timeframe      IS NULL OR length(timeframe) <= 60),
  message         text          CHECK (message        IS NULL OR length(message) <= 2000),

  -- ── Where they came from ─────────────────────────────────────────────────
  -- 'website' = the demo form. 'manual' = added by an admin after a conversation.
  -- Knowing which channel produces leads that convert is the reason to ask at all.
  source          text NOT NULL DEFAULT 'website'
                  CHECK (source IN ('website','manual','referral','event','linkedin','partner','other')),
  source_detail   text          CHECK (source_detail IS NULL OR length(source_detail) <= 160),

  -- ── The toggle ───────────────────────────────────────────────────────────
  -- Flip this and the row moves from the Leads list to the Opportunities list.
  -- That is the whole promotion mechanism.
  is_opportunity  boolean NOT NULL DEFAULT false,
  promoted_at     timestamptz,          -- stamped by trigger on first promotion

  -- ── Open, or finished ────────────────────────────────────────────────────
  status          text NOT NULL DEFAULT 'open'
                  CHECK (status IN ('open','won','lost')),
  lost_reason     text          CHECK (lost_reason IS NULL OR length(lost_reason) <= 300),

  -- ── Working it ───────────────────────────────────────────────────────────
  owner_id        uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  notes           text          CHECK (notes IS NULL OR length(notes) <= 4000),
  next_action     text          CHECK (next_action IS NULL OR length(next_action) <= 300),
  next_action_on  date,
  last_contacted  timestamptz,

  -- ── Conversion ───────────────────────────────────────────────────────────
  -- Set when the lead becomes a client, so where every client came from stays
  -- traceable. ON DELETE SET NULL: removing a client must not erase the record of
  -- how it was won.
  converted_client_id uuid REFERENCES public.clients(id) ON DELETE SET NULL,
  converted_at        timestamptz,

  -- ── The sample report ────────────────────────────────────────────────────
  -- The marketing site gates the Meridian sample report behind registration, so
  -- this is also the record of what we owe them.
  report_sent     boolean NOT NULL DEFAULT false,
  report_sent_at  timestamptz,

  -- ── Anti-spam ────────────────────────────────────────────────────────────
  is_spam         boolean NOT NULL DEFAULT false,

  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),

  -- "Won" must mean a client actually exists. Otherwise the pipeline can report
  -- wins with nothing behind them, which is exactly the kind of comfortable
  -- number this platform exists to refuse.
  CONSTRAINT leads_won_has_client
    CHECK (status <> 'won' OR converted_client_id IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_leads_bucket  ON public.leads(status, is_opportunity) WHERE is_spam = false;
CREATE INDEX IF NOT EXISTS idx_leads_created ON public.leads(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_leads_owner   ON public.leads(owner_id);
CREATE INDEX IF NOT EXISTS idx_leads_email   ON public.leads(lower(email));

-- Timestamps the UI should not have to remember to set.
CREATE OR REPLACE FUNCTION public.leads_touch()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  -- First time it is toggled into an opportunity, record when.
  IF NEW.is_opportunity AND NOT OLD.is_opportunity AND NEW.promoted_at IS NULL THEN
    NEW.promoted_at := now();
  END IF;
  -- First time a client is linked, record when.
  IF NEW.converted_client_id IS NOT NULL AND OLD.converted_client_id IS NULL THEN
    NEW.converted_at := now();
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS leads_touch_trg ON public.leads;
CREATE TRIGGER leads_touch_trg
  BEFORE UPDATE ON public.leads
  FOR EACH ROW EXECUTE FUNCTION public.leads_touch();

-- ─────────────────────────────────────────────────────────────
-- 2. RLS — public in, admin only out
-- ─────────────────────────────────────────────────────────────
ALTER TABLE public.leads ENABLE ROW LEVEL SECURITY;

-- Anyone may submit. There is deliberately NO select policy for anon, so a
-- submitter cannot read the table back — not their own row, not anyone else's.
DROP POLICY IF EXISTS "Anyone can submit a lead" ON public.leads;
CREATE POLICY "Anyone can submit a lead" ON public.leads
  FOR INSERT TO anon, authenticated
  WITH CHECK (true);

-- Only Master Admins see or work the pipeline. Client admins have no business here.
DROP POLICY IF EXISTS "Admins manage leads" ON public.leads;
CREATE POLICY "Admins manage leads" ON public.leads
  FOR ALL TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());

-- Table-level GRANT — a SEPARATE gate from RLS. RLS decides which rows a role may
-- touch; this decides whether the role may touch the table at all, and both must be
-- open. Omitting it is what produced "permission denied for table comms_items" in
-- the running app while every test and the SQL editor passed.
--
-- REVOKE FIRST. Supabase's default privileges already hand rights to anon and
-- authenticated on new tables in `public`, and a GRANT can only ADD to what a role
-- holds — it never restricts. Without these REVOKEs, anon ended up with
-- INSERT, REFERENCES, TRIGGER and TRUNCATE here.
--
-- TRUNCATE is the dangerous one: the anon key is public (it ships in the browser
-- bundle), and PostgreSQL does NOT apply row security policies to TRUNCATE. So the
-- careful RLS above would not have stopped a stranger emptying this table.
REVOKE ALL ON public.leads FROM anon;
REVOKE ALL ON public.leads FROM authenticated;

-- anon gets INSERT and nothing else. That is the entire public surface.
GRANT INSERT                          ON public.leads TO anon;
-- authenticated gets CRUD but deliberately NOT truncate — the app has no reason to
-- empty this table, so no bug in the app can either.
GRANT SELECT, INSERT, UPDATE, DELETE  ON public.leads TO authenticated;

-- ─────────────────────────────────────────────────────────────
-- 3. The pipeline view — one place that decides which list a row is in
-- ─────────────────────────────────────────────────────────────
-- security_invoker = on so the base table's RLS applies to whoever queries the
-- view, rather than the view owner's rights. Without it the view would hand the
-- whole pipeline to anyone who could reach it.
DROP VIEW IF EXISTS public.lead_pipeline;
CREATE VIEW public.lead_pipeline
  WITH (security_invoker = on) AS
SELECT
  l.*,
  c.name AS converted_client_name,

  -- Which list this belongs in. Defined once, here, so the UI, a report and any
  -- future export cannot disagree about what counts as an opportunity.
  CASE
    WHEN l.status <> 'open'    THEN 'closed'
    WHEN l.is_opportunity      THEN 'opportunity'
    ELSE 'lead'
  END AS bucket,

  -- Days since it arrived, and since anyone last touched it. A lead nobody has
  -- contacted in three weeks is precisely what this table exists to make visible.
  (CURRENT_DATE - l.created_at::date)                             AS age_days,
  (CURRENT_DATE - coalesce(l.last_contacted, l.created_at)::date) AS days_since_contact,

  -- Overdue next action. Same rule as the comms plan: a date that has passed is a
  -- fact, not a suggestion.
  (l.next_action_on IS NOT NULL
    AND l.next_action_on < CURRENT_DATE
    AND l.status = 'open')                                        AS action_overdue
FROM public.leads l
LEFT JOIN public.clients c ON c.id = l.converted_client_id
WHERE l.is_spam = false;

REVOKE ALL   ON public.lead_pipeline FROM anon, authenticated;
GRANT SELECT ON public.lead_pipeline TO authenticated;

-- ─────────────────────────────────────────────────────────────
-- 4. Checks
-- ─────────────────────────────────────────────────────────────
-- a) Both gates open for the right roles, and only those.
SELECT grantee, string_agg(privilege_type, ', ' ORDER BY privilege_type) AS privileges
FROM information_schema.role_table_grants
WHERE table_schema = 'public' AND table_name = 'leads' AND grantee IN ('anon','authenticated')
GROUP BY grantee ORDER BY grantee;
-- Expect exactly:  anon → INSERT      authenticated → DELETE, INSERT, SELECT, UPDATE

-- b) The pipeline, once there is anything in it.
SELECT bucket, status, count(*) AS n
FROM public.lead_pipeline
GROUP BY bucket, status
ORDER BY bucket, status;
