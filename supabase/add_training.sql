-- ChangeFlow: training modules + the needs matrix.
--
-- STEP 3 of the people-leader training build.
--   Step 1  audiences                    ✓
--   Step 2  heat map from audiences      ✓
--   Step 3  modules + needs matrix       ← this
--   Step 4  needs matrix UI
--   Step 5  people-leader fortnightly check
--
-- WHAT A "NEEDS ANALYSIS" ACTUALLY IS
--   Two lists and the grid between them: the groups the change lands on (audiences,
--   already built) and what each group has to be able to do afterwards (modules).
--   The matrix is the analysis — it is the artefact a change manager is asked for,
--   and today it lives in a spreadsheet on someone's laptop.
--
-- WHY NO PARTICIPANT REGISTER
--   Deliberate, and the decision that shaped this whole design. Naming every person
--   means importing HR data, keeping it current, and handling leavers — months of
--   work before anyone sees a number. Coverage instead comes from the people-leader
--   for each audience answering "how many of your 180 are through?" every fortnight.
--   Less precise, available immediately, and the leader is the one who can actually
--   do something about a gap.
--
-- Safe to re-run.

-- ─────────────────────────────────────────────────────────────
-- 1. Modules — what people have to be able to do
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.training_modules (
  id           uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id   uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  name         text NOT NULL,

  -- How it is delivered changes what a gap costs to close. Twenty people short on a
  -- self-paced module is an email; twenty short on a classroom module is another
  -- session, a room and a trainer, and that has to be visible before go-live week.
  delivery     text CHECK (delivery IN ('classroom','virtual','self_paced','on_the_job','briefing')),
  duration_min int  CHECK (duration_min IS NULL OR duration_min > 0),

  -- Who builds and runs it. Distinct from the audience owner, who reports coverage.
  owner_name   text,
  owner_id     uuid REFERENCES auth.users(id) ON DELETE SET NULL,

  -- When the material itself is ready. A module still in build cannot be delivered,
  -- so an audience showing 0% against it is not a leader failing to act.
  status       text DEFAULT 'planned' CHECK (status IN ('planned','in_build','ready','retired')),
  ready_on     date,

  -- Anchors delivery to the plan. Coverage is only meaningful against a date.
  window_start date,
  window_end   date,

  notes        text,
  sort_order   int DEFAULT 0,
  created_at   timestamptz DEFAULT now(),
  updated_at   timestamptz DEFAULT now(),
  UNIQUE (project_id, name)
);

CREATE INDEX IF NOT EXISTS idx_training_modules_project ON public.training_modules(project_id, sort_order);

-- ─────────────────────────────────────────────────────────────
-- 2. The needs matrix — which groups need which modules
-- ─────────────────────────────────────────────────────────────
-- A row exists only where there is a need. Absence means "not required", which is why
-- there is no 'not_required' necessity value: an empty cell already says that, and two
-- ways to say the same thing eventually disagree.
CREATE TABLE IF NOT EXISTS public.training_needs (
  id          uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  audience_id uuid NOT NULL REFERENCES public.audiences(id)        ON DELETE CASCADE,
  module_id   uuid NOT NULL REFERENCES public.training_modules(id) ON DELETE CASCADE,

  -- Mandatory blocks the readiness gate; recommended does not. Without the
  -- distinction every gap looks equally serious and the gate becomes noise.
  necessity   text NOT NULL DEFAULT 'mandatory' CHECK (necessity IN ('mandatory','recommended')),

  -- Overrides the audience headcount for this module when only part of the group
  -- needs it — 30 of the 180 Billing Officers do refunds. NULL = the whole group,
  -- which is the common case and should not need typing.
  applies_to  int CHECK (applies_to IS NULL OR applies_to >= 0),

  notes       text,
  created_at  timestamptz DEFAULT now(),
  UNIQUE (audience_id, module_id)
);

CREATE INDEX IF NOT EXISTS idx_training_needs_audience ON public.training_needs(audience_id);
CREATE INDEX IF NOT EXISTS idx_training_needs_module   ON public.training_needs(module_id);

-- An audience and a module must belong to the same project. Without this, a stray id
-- silently produces a matrix cell joining two unrelated programmes, and it would show
-- up as a coverage number rather than as an error.
CREATE OR REPLACE FUNCTION public.training_need_same_project() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE a_project uuid; m_project uuid;
BEGIN
  SELECT project_id INTO a_project FROM public.audiences        WHERE id = NEW.audience_id;
  SELECT project_id INTO m_project FROM public.training_modules WHERE id = NEW.module_id;
  IF a_project IS DISTINCT FROM m_project THEN
    RAISE EXCEPTION 'audience and module belong to different projects (% vs %)', a_project, m_project;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_training_need_project ON public.training_needs;
CREATE TRIGGER trg_training_need_project BEFORE INSERT OR UPDATE ON public.training_needs
  FOR EACH ROW EXECUTE FUNCTION public.training_need_same_project();

-- ─────────────────────────────────────────────────────────────
-- 3. Demand view — how many people need each module
-- ─────────────────────────────────────────────────────────────
-- A view, not a stored column, for the reason established with coverage: a derived
-- number with two sources of truth eventually shows two different answers, and the
-- one in the Word report is always the stale one.
--
-- people_needed is NULL when the audience size is unknown and no applies_to overrides
-- it. NULL must survive all the way to the renderer: an unsized group is a gap to
-- close, not a group of nobody, and COALESCE(...,0) here would make a module with no
-- known audience read as fully covered.
CREATE OR REPLACE VIEW public.training_demand AS
SELECT
  n.id            AS need_id,
  m.project_id,
  n.module_id,
  m.name          AS module_name,
  m.delivery,
  m.status        AS module_status,
  m.window_start,
  m.window_end,
  n.audience_id,
  a.name          AS audience_name,
  a.owner_name    AS audience_owner,
  n.necessity,
  COALESCE(n.applies_to, a.headcount) AS people_needed,
  (COALESCE(n.applies_to, a.headcount) IS NULL) AS size_unknown
FROM public.training_needs n
JOIN public.training_modules m ON m.id = n.module_id
JOIN public.audiences       a ON a.id = n.audience_id;

-- ─────────────────────────────────────────────────────────────
-- 4. RLS — mirrors audiences exactly
-- ─────────────────────────────────────────────────────────────
ALTER TABLE public.training_modules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.training_needs   ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins manage modules" ON public.training_modules;
CREATE POLICY "Admins manage modules" ON public.training_modules FOR ALL
  USING (public.is_admin()) WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "Client admins manage their modules" ON public.training_modules;
CREATE POLICY "Client admins manage their modules" ON public.training_modules FOR ALL
  USING      (public.is_client_admin() AND EXISTS (SELECT 1 FROM public.projects p WHERE p.id = training_modules.project_id AND p.client_id = public.my_client_id()))
  WITH CHECK (public.is_client_admin() AND EXISTS (SELECT 1 FROM public.projects p WHERE p.id = training_modules.project_id AND p.client_id = public.my_client_id()));

DROP POLICY IF EXISTS "Members read their project modules" ON public.training_modules;
CREATE POLICY "Members read their project modules" ON public.training_modules FOR SELECT
  USING (EXISTS (SELECT 1 FROM public.project_members m WHERE m.project_id = training_modules.project_id AND m.user_id = auth.uid()));

-- Needs have no project_id of their own, so every policy reaches through the module.
DROP POLICY IF EXISTS "Admins manage needs" ON public.training_needs;
CREATE POLICY "Admins manage needs" ON public.training_needs FOR ALL
  USING (public.is_admin()) WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "Client admins manage their needs" ON public.training_needs;
CREATE POLICY "Client admins manage their needs" ON public.training_needs FOR ALL
  USING      (public.is_client_admin() AND EXISTS (SELECT 1 FROM public.training_modules m JOIN public.projects p ON p.id = m.project_id WHERE m.id = training_needs.module_id AND p.client_id = public.my_client_id()))
  WITH CHECK (public.is_client_admin() AND EXISTS (SELECT 1 FROM public.training_modules m JOIN public.projects p ON p.id = m.project_id WHERE m.id = training_needs.module_id AND p.client_id = public.my_client_id()));

DROP POLICY IF EXISTS "Members read their project needs" ON public.training_needs;
CREATE POLICY "Members read their project needs" ON public.training_needs FOR SELECT
  USING (EXISTS (SELECT 1 FROM public.training_modules m JOIN public.project_members pm ON pm.project_id = m.project_id
                 WHERE m.id = training_needs.module_id AND pm.user_id = auth.uid()));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.training_modules TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.training_needs   TO authenticated;
GRANT SELECT ON public.training_demand TO authenticated;

-- ─────────────────────────────────────────────────────────────
-- 5. Seed Meridian
-- ─────────────────────────────────────────────────────────────
-- Every edge case the matrix has to render is present on purpose:
--   • a module still in build      (Refund Processing) — 0% is not the leader's fault
--   • a partial audience           (30 of 180 do refunds via applies_to)
--   • an unsized audience          (Field Services) — demand is genuinely unknown
--   • a recommended-only need      (Finance on Single Customer View)
--   • a group needing one module   (I&T) next to one needing four (Billing Ops)
DO $$
DECLARE v_project uuid;
BEGIN
  SELECT p.id INTO v_project
  FROM public.projects p JOIN public.clients c ON c.id = p.client_id
  WHERE c.name = 'Meridian Water Corporation (Demo)' LIMIT 1;

  IF v_project IS NULL THEN
    RAISE NOTICE 'Meridian demo project not found — tables created, seed skipped.';
    RETURN;
  END IF;

  INSERT INTO public.training_modules (project_id, name, delivery, duration_min, owner_name, status, ready_on, window_start, window_end, notes, sort_order) VALUES
    (v_project, 'New Billing Console — core',   'classroom',   240, 'L. Fraser',    'ready',    DATE '2026-10-30', DATE '2026-11-16', DATE '2026-12-18', 'Hands-on in the training environment.',            0),
    (v_project, 'Exception queue handling',     'virtual',      90, 'L. Fraser',    'ready',    DATE '2026-11-06', DATE '2026-11-23', DATE '2026-12-18', 'Follows the core module.',                         1),
    (v_project, 'Single Customer View',         'virtual',      60, 'S. Whitcombe', 'ready',    DATE '2026-10-23', DATE '2026-11-09', DATE '2027-01-15', 'Enquiry handling in the new console.',             2),
    (v_project, 'Refund Processing',            'classroom',   120, 'L. Fraser',    'in_build', NULL,              DATE '2027-01-05', DATE '2027-01-30', 'Blocked on the vendor confirming the refund flow.', 3),
    (v_project, 'Mobile meter app',             'self_paced',   45, 'M. Reilly',    'ready',    DATE '2026-11-13', DATE '2026-11-30', DATE '2027-01-29', 'In-app guidance; no classroom required.',          4),
    (v_project, 'Month-end reconciliation',     'on_the_job',  180, 'A. Nguyen',    'planned',  NULL,              DATE '2027-01-11', DATE '2027-02-12', 'Runs alongside the parallel close.',               5),
    (v_project, 'Day-one support briefing',     'briefing',     30, 'P. Raman',     'planned',  NULL,              DATE '2027-02-09', DATE '2027-02-13', 'Everyone, the week of go-live.',                   6)
  ON CONFLICT (project_id, name) DO NOTHING;

  -- The matrix. applies_to only where the whole group is not in scope.
  INSERT INTO public.training_needs (audience_id, module_id, necessity, applies_to, notes)
  SELECT a.id, m.id, v.necessity, v.applies_to, v.notes
  FROM (VALUES
    ('Billing Operations',       'New Billing Console — core', 'mandatory',   NULL, NULL),
    ('Billing Operations',       'Exception queue handling',   'mandatory',   NULL, NULL),
    ('Billing Operations',       'Refund Processing',          'mandatory',   30,   'Only the refunds team.'),
    ('Billing Operations',       'Day-one support briefing',   'mandatory',   NULL, NULL),
    ('Contact Centre',           'Single Customer View',       'mandatory',   NULL, NULL),
    ('Contact Centre',           'New Billing Console — core', 'recommended', 40,   'Team leaders only, for escalations.'),
    ('Contact Centre',           'Day-one support briefing',   'mandatory',   NULL, NULL),
    ('Field Services',           'Mobile meter app',           'mandatory',   NULL, 'Headcount still unconfirmed — demand cannot be sized.'),
    ('Field Services',           'Day-one support briefing',   'mandatory',   NULL, NULL),
    ('Finance',                  'Month-end reconciliation',   'mandatory',   NULL, NULL),
    ('Finance',                  'Single Customer View',       'recommended', NULL, 'Useful context, not required to do the job.'),
    ('Information & Technology', 'Day-one support briefing',   'mandatory',   NULL, 'Hypercare roster.')
  ) AS v(audience, module, necessity, applies_to, notes)
  JOIN public.audiences       a ON a.project_id = v_project AND a.name = v.audience
  JOIN public.training_modules m ON m.project_id = v_project AND m.name = v.module
  ON CONFLICT (audience_id, module_id) DO NOTHING;
END $$;

-- What the matrix looks like. Note Field Services: 'unknown', never 0.
SELECT audience_name, module_name, necessity,
       COALESCE(people_needed::text, 'unknown') AS people_needed,
       module_status
FROM public.training_demand
WHERE project_id = (SELECT p.id FROM public.projects p JOIN public.clients c ON c.id = p.client_id
                    WHERE c.name = 'Meridian Water Corporation (Demo)' LIMIT 1)
ORDER BY audience_name, module_name;
