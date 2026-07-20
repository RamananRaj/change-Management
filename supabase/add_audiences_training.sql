-- ⚠️ SUPERSEDED — DO NOT RUN. Kept for reference only.
--
-- This was the participant-register design: training_completions with one row per
-- person. We changed approach — coverage now comes from a fortnightly check answered
-- by each audience's people-leader ("of your 140, how many have completed this?"),
-- which removes the need to record hundreds of individuals who have no account.
--
-- Run `add_audiences.sql` instead. Retained because the completions design is still
-- the right shape IF a client ever needs name-level evidence, most likely fed from
-- their LMS rather than typed.
--
-- ─────────────────────────────────────────────────────────────────────────────
--
-- ChangeFlow: audiences + training needs analysis.
--
-- WHY THESE ARE SEPARATE FROM phase_content
--   phase_content describes what the CHANGE TEAM does — pathway activities completed by
--   ChangeFlow members and tracked in user_activities. Training modules describe what
--   END USERS do: hundreds of people who will never hold an account. Same shape, two
--   populations. Overloading one table would mean a content_type filter on every query
--   and two completion tables pointing at the same ids.
--   The client_id / global-library pattern IS copied from phase_content, so the Content
--   Manager UI and the "promote to global" action work identically.
--
-- PERMISSIONS
--   Client Admin manages audiences, modules, needs and manual completions for their own
--   client — they run the training, and Master Admin should not be a bottleneck for
--   routine entry. BULK CSV import is Master Admin only: it moves gate status in one
--   action, so it gets the tighter permission.
--
-- Safe to re-run.

-- ─────────────────────────────────────────────────────────────
-- 1. audiences — a group a change lands on
-- ─────────────────────────────────────────────────────────────
-- Project-scoped, not global: the same organisation splits differently for a billing
-- change than for a depot restructure, and one global list makes both wrong.
CREATE TABLE IF NOT EXISTS public.audiences (
  id           uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id   uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  name         text NOT NULL,
  parent_id    uuid REFERENCES public.audiences(id) ON DELETE SET NULL,
  -- NULL = nobody has established the size. Deliberately nullable: a zero would make
  -- every coverage percentage that divides by it silently wrong, and "0 of 0 trained"
  -- reads as complete. Unknown must stay unknown.
  headcount    int CHECK (headcount IS NULL OR headcount >= 0),
  impact_level text CHECK (impact_level IN ('vh','h','m','l','vl','none')),
  owner_id     uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  notes        text,
  sort_order   int DEFAULT 0,
  created_at   timestamptz DEFAULT now(),
  UNIQUE (project_id, name)
);

CREATE INDEX IF NOT EXISTS idx_audiences_project ON public.audiences(project_id, sort_order);

ALTER TABLE public.audiences ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins manage audiences" ON public.audiences;
CREATE POLICY "Admins manage audiences" ON public.audiences FOR ALL
  USING (public.is_admin()) WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "Client admins manage their audiences" ON public.audiences;
CREATE POLICY "Client admins manage their audiences" ON public.audiences FOR ALL
  USING      (public.is_client_admin() AND EXISTS (SELECT 1 FROM public.projects p WHERE p.id = audiences.project_id AND p.client_id = public.my_client_id()))
  WITH CHECK (public.is_client_admin() AND EXISTS (SELECT 1 FROM public.projects p WHERE p.id = audiences.project_id AND p.client_id = public.my_client_id()));

DROP POLICY IF EXISTS "Members read their project audiences" ON public.audiences;
CREATE POLICY "Members read their project audiences" ON public.audiences FOR SELECT
  USING (EXISTS (SELECT 1 FROM public.project_members m WHERE m.project_id = audiences.project_id AND m.user_id = auth.uid()));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.audiences TO authenticated;

-- ─────────────────────────────────────────────────────────────
-- 2. training_modules — the library
-- ─────────────────────────────────────────────────────────────
-- client_id NULL = global library entry, exactly as phase_content works, so the same
-- "promote to global" action applies and the Content Manager can list both.
CREATE TABLE IF NOT EXISTS public.training_modules (
  id              uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id       uuid REFERENCES public.clients(id) ON DELETE CASCADE,
  name            text NOT NULL,
  description     text,
  delivery        text CHECK (delivery IN ('classroom','virtual','elearning','floor_walking','self_serve')),
  duration_min    int,
  prerequisite_id uuid REFERENCES public.training_modules(id) ON DELETE SET NULL,
  is_active       boolean DEFAULT true,
  sort_order      int DEFAULT 0,
  created_at      timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_training_modules_client ON public.training_modules(client_id, sort_order);

ALTER TABLE public.training_modules ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins manage modules" ON public.training_modules;
CREATE POLICY "Admins manage modules" ON public.training_modules FOR ALL
  USING (public.is_admin()) WITH CHECK (public.is_admin());

-- A client admin manages their own modules but may READ the global library, so they can
-- pull a standard module into their programme without being able to edit it for everyone.
DROP POLICY IF EXISTS "Client admins manage their modules" ON public.training_modules;
CREATE POLICY "Client admins manage their modules" ON public.training_modules FOR ALL
  USING      (public.is_client_admin() AND client_id = public.my_client_id())
  WITH CHECK (public.is_client_admin() AND client_id = public.my_client_id());

DROP POLICY IF EXISTS "Read own or global modules" ON public.training_modules;
CREATE POLICY "Read own or global modules" ON public.training_modules FOR SELECT
  USING (is_active = true AND (client_id IS NULL OR client_id = public.my_client_id() OR public.is_admin()));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.training_modules TO authenticated;

-- ─────────────────────────────────────────────────────────────
-- 3. training_needs — the analysis itself
-- ─────────────────────────────────────────────────────────────
-- One row per audience × module. This grid IS the needs analysis; there is no separate
-- document describing it.
CREATE TABLE IF NOT EXISTS public.training_needs (
  id          uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id  uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  audience_id uuid NOT NULL REFERENCES public.audiences(id) ON DELETE CASCADE,
  module_id   uuid NOT NULL REFERENCES public.training_modules(id) ON DELETE CASCADE,
  necessity   text NOT NULL DEFAULT 'required' CHECK (necessity IN ('required','recommended','optional')),
  target_pct  int DEFAULT 90 CHECK (target_pct BETWEEN 0 AND 100),
  due_on      date,
  created_at  timestamptz DEFAULT now(),
  UNIQUE (audience_id, module_id)
);

CREATE INDEX IF NOT EXISTS idx_training_needs_project ON public.training_needs(project_id);

ALTER TABLE public.training_needs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins manage needs" ON public.training_needs;
CREATE POLICY "Admins manage needs" ON public.training_needs FOR ALL
  USING (public.is_admin()) WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "Client admins manage their needs" ON public.training_needs;
CREATE POLICY "Client admins manage their needs" ON public.training_needs FOR ALL
  USING      (public.is_client_admin() AND EXISTS (SELECT 1 FROM public.projects p WHERE p.id = training_needs.project_id AND p.client_id = public.my_client_id()))
  WITH CHECK (public.is_client_admin() AND EXISTS (SELECT 1 FROM public.projects p WHERE p.id = training_needs.project_id AND p.client_id = public.my_client_id()));

DROP POLICY IF EXISTS "Members read their project needs" ON public.training_needs;
CREATE POLICY "Members read their project needs" ON public.training_needs FOR SELECT
  USING (EXISTS (SELECT 1 FROM public.project_members m WHERE m.project_id = training_needs.project_id AND m.user_id = auth.uid()));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.training_needs TO authenticated;

-- ─────────────────────────────────────────────────────────────
-- 4. training_completions — who actually did it
-- ─────────────────────────────────────────────────────────────
-- person_ref is TEXT, not a reference to auth.users, and that is the single most
-- important decision in this migration. Hundreds of end users need training and will
-- never hold a ChangeFlow account. Keying this to auth.users would mean creating
-- hundreds of dormant accounts — the thing that makes modules like this unusable in
-- the field. It keys on whatever identifier the client already uses.
--
-- Rows are created as training happens. There is no roster to load up front: the named
-- participants for an audience are exactly the people someone has recorded.
CREATE TABLE IF NOT EXISTS public.training_completions (
  id           uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id   uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  module_id    uuid NOT NULL REFERENCES public.training_modules(id) ON DELETE CASCADE,
  audience_id  uuid REFERENCES public.audiences(id) ON DELETE SET NULL,
  person_ref   text NOT NULL,
  person_name  text,
  status       text NOT NULL DEFAULT 'completed'
               CHECK (status IN ('enrolled','completed','exempt','failed')),
  completed_on date,
  source       text,                      -- 'manual' | 'csv:2026-11-12' | 'lms:<name>'
  created_by   uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at   timestamptz DEFAULT now(),
  UNIQUE (module_id, person_ref)
);

CREATE INDEX IF NOT EXISTS idx_completions_lookup
  ON public.training_completions(project_id, audience_id, module_id, status);

ALTER TABLE public.training_completions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins manage completions" ON public.training_completions;
CREATE POLICY "Admins manage completions" ON public.training_completions FOR ALL
  USING (public.is_admin()) WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "Client admins manage their completions" ON public.training_completions;
CREATE POLICY "Client admins manage their completions" ON public.training_completions FOR ALL
  USING      (public.is_client_admin() AND EXISTS (SELECT 1 FROM public.projects p WHERE p.id = training_completions.project_id AND p.client_id = public.my_client_id()))
  WITH CHECK (public.is_client_admin() AND EXISTS (SELECT 1 FROM public.projects p WHERE p.id = training_completions.project_id AND p.client_id = public.my_client_id()));

DROP POLICY IF EXISTS "Members read their project completions" ON public.training_completions;
CREATE POLICY "Members read their project completions" ON public.training_completions FOR SELECT
  USING (EXISTS (SELECT 1 FROM public.project_members m WHERE m.project_id = training_completions.project_id AND m.user_id = auth.uid()));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.training_completions TO authenticated;

-- ─────────────────────────────────────────────────────────────
-- 5. Coverage view — computed, never stored
-- ─────────────────────────────────────────────────────────────
-- Storing coverage would let it drift from the completions that produce it. This view
-- is the single definition, so the gate criterion, CORA and the report cannot disagree.
--
-- pct is NULL when headcount is unknown. Callers must render that as "unknown" rather
-- than coercing to 0 — a group nobody has sized is not a group nobody has trained.
CREATE OR REPLACE VIEW public.training_coverage AS
SELECT
  n.project_id,
  n.audience_id,
  a.name           AS audience_name,
  a.headcount,
  n.module_id,
  m.name           AS module_name,
  n.necessity,
  n.target_pct,
  n.due_on,
  COUNT(c.id) FILTER (WHERE c.status = 'completed') AS completed,
  COUNT(c.id) FILTER (WHERE c.status = 'enrolled')  AS enrolled,
  COUNT(c.id) FILTER (WHERE c.status = 'exempt')    AS exempt,
  CASE WHEN a.headcount IS NULL OR a.headcount = 0 THEN NULL
       ELSE ROUND(COUNT(c.id) FILTER (WHERE c.status = 'completed')::numeric / a.headcount * 100)
  END AS pct
FROM public.training_needs n
JOIN public.audiences a        ON a.id = n.audience_id
JOIN public.training_modules m ON m.id = n.module_id
LEFT JOIN public.training_completions c
       ON c.module_id = n.module_id AND c.audience_id = n.audience_id
GROUP BY n.project_id, n.audience_id, a.name, a.headcount, n.module_id, m.name,
         n.necessity, n.target_pct, n.due_on;

GRANT SELECT ON public.training_coverage TO authenticated;

SELECT 'audiences + training needs analysis added' AS result;
