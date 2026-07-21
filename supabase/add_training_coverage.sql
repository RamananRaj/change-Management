-- ChangeFlow: training coverage via people-leader self-report.
--
-- STEP 5 of the people-leader training build.
--   Step 1  audiences                    ✓
--   Step 2  heat map from audiences      ✓
--   Step 3  modules + needs matrix       ✓
--   Step 4  needs matrix UI              ✓
--   Step 5  coverage checks              ← this
--
-- THE WHOLE DESIGN IN ONE LINE
--   Nobody is named. The leader of each audience answers "how many of your 180 are
--   through?" and that answer, dated, is the coverage record.
--
-- WHY A CHECK IS A ROW PER DATE, NOT A COLUMN ON training_needs
--   A single "trained" column would answer "where are we?" and destroy "are we moving?".
--   Coverage that has sat at 60% for three weeks is a different problem from coverage
--   that reached 60% yesterday, and only history tells them apart. This mirrors
--   progress_snapshots, which exists for the same reason.
--
-- THE RULE THIS TABLE EXISTS TO PROTECT
--   A leader who has not answered must never render as 0%. Unasked and answered-zero
--   look identical in a bar chart and mean opposite things — one is a reporting gap,
--   the other is a training gap, and only one of them is the leader's problem. Hence
--   trained is NULLABLE, and "no row at all" is a third distinct state.
--
-- Safe to re-run.

CREATE TABLE IF NOT EXISTS public.training_checks (
  id         uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  need_id    uuid NOT NULL REFERENCES public.training_needs(id) ON DELETE CASCADE,

  -- The date the leader is reporting AS AT, not when they typed it. A leader catching
  -- up on Friday for a Tuesday check is reporting Tuesday's position.
  as_at      date NOT NULL,

  -- NULL = asked, not answered. Distinct from 0 = answered, nobody trained yet.
  trained    int CHECK (trained IS NULL OR trained >= 0),

  reported_by      uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  reported_by_name text,
  note       text,

  created_at timestamptz DEFAULT now(),
  -- One answer per need per date. Re-reporting the same date corrects it rather than
  -- appending, so a leader fixing a typo does not create two truths.
  UNIQUE (need_id, as_at)
);

CREATE INDEX IF NOT EXISTS idx_training_checks_need ON public.training_checks(need_id, as_at DESC);

-- ─────────────────────────────────────────────────────────────
-- Current coverage — latest answer per need
-- ─────────────────────────────────────────────────────────────
-- A view, not a stored column. Same reason as training_demand and the heat map: a
-- derived number with two sources of truth eventually disagrees, and the stale one is
-- always the one that reaches the client's Word report.
CREATE OR REPLACE VIEW public.training_coverage AS
SELECT
  d.need_id, d.project_id, d.module_id, d.module_name, d.delivery, d.module_status,
  d.window_start, d.window_end,
  d.audience_id, d.audience_name, d.audience_owner, d.necessity,
  d.people_needed, d.size_unknown,
  c.as_at            AS last_checked,
  c.trained,
  c.reported_by_name,
  c.note,
  -- NULL when there is nothing honest to divide: no answer, or no known denominator.
  -- Never 0, and never 100 from 0/0 — "0 of 0 trained" rendering as complete is the
  -- same failure as an unassessed gate unit showing green.
  CASE
    WHEN c.trained IS NULL OR d.people_needed IS NULL OR d.people_needed = 0 THEN NULL
    ELSE LEAST(100, ROUND(100.0 * c.trained / d.people_needed))
  END AS pct,
  -- Why there is no percentage, in the view rather than in each renderer, so the canvas
  -- and the Word report cannot give different reasons for the same blank.
  CASE
    WHEN c.as_at IS NULL           THEN 'never_reported'
    WHEN c.trained IS NULL         THEN 'not_answered'
    WHEN d.people_needed IS NULL   THEN 'size_unknown'
    WHEN d.people_needed = 0       THEN 'nobody_to_train'
    ELSE NULL
  END AS gap_reason
FROM public.training_demand d
LEFT JOIN LATERAL (
  SELECT as_at, trained, reported_by_name, note
  FROM public.training_checks
  WHERE need_id = d.need_id
  ORDER BY as_at DESC
  LIMIT 1
) c ON true;

-- ─────────────────────────────────────────────────────────────
-- RLS — mirrors training_needs, reaching through to the project
-- ─────────────────────────────────────────────────────────────
ALTER TABLE public.training_checks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins manage checks" ON public.training_checks;
CREATE POLICY "Admins manage checks" ON public.training_checks FOR ALL
  USING (public.is_admin()) WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "Client admins manage their checks" ON public.training_checks;
CREATE POLICY "Client admins manage their checks" ON public.training_checks FOR ALL
  USING      (public.is_client_admin() AND EXISTS (
                SELECT 1 FROM public.training_needs n
                JOIN public.training_modules m ON m.id = n.module_id
                JOIN public.projects p ON p.id = m.project_id
                WHERE n.id = training_checks.need_id AND p.client_id = public.my_client_id()))
  WITH CHECK (public.is_client_admin() AND EXISTS (
                SELECT 1 FROM public.training_needs n
                JOIN public.training_modules m ON m.id = n.module_id
                JOIN public.projects p ON p.id = m.project_id
                WHERE n.id = training_checks.need_id AND p.client_id = public.my_client_id()));

-- Project members can both read and WRITE checks. This is the point of the design:
-- the people-leader reporting coverage is a normal member, not an admin. Requiring
-- admin rights to answer "how many of my team are trained" would push every answer
-- back through the change manager, which is the manual process this replaces.
DROP POLICY IF EXISTS "Members report on their project" ON public.training_checks;
CREATE POLICY "Members report on their project" ON public.training_checks FOR ALL
  USING      (EXISTS (SELECT 1 FROM public.training_needs n
                      JOIN public.training_modules m ON m.id = n.module_id
                      JOIN public.project_members pm ON pm.project_id = m.project_id
                      WHERE n.id = training_checks.need_id AND pm.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.training_needs n
                      JOIN public.training_modules m ON m.id = n.module_id
                      JOIN public.project_members pm ON pm.project_id = m.project_id
                      WHERE n.id = training_checks.need_id AND pm.user_id = auth.uid()));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.training_checks TO authenticated;
GRANT SELECT ON public.training_coverage TO authenticated;

-- ─────────────────────────────────────────────────────────────
-- Seed Meridian — two rounds, so there is a trend and not just a position
-- ─────────────────────────────────────────────────────────────
-- Every state the renderer has to tell apart is present on purpose:
--   • moving well          Billing Ops on the core console (110 → 158 of 180)
--   • stalled              Contact Centre on Single Customer View (95 → 98 of 140)
--   • answered zero        Finance on month-end — genuinely nobody trained yet
--   • never reported       Field Services — no owner, so nobody was asked
--   • blocked by material  Refund Processing is still in build; 0 is not the leader
--   • unsized demand       Field Services again — no denominator to divide by
DO $$
DECLARE v_project uuid;
BEGIN
  SELECT p.id INTO v_project
  FROM public.projects p JOIN public.clients c ON c.id = p.client_id
  WHERE c.name = 'Meridian Water Corporation (Demo)' LIMIT 1;

  IF v_project IS NULL THEN
    RAISE NOTICE 'Meridian demo project not found — table created, seed skipped.';
    RETURN;
  END IF;

  INSERT INTO public.training_checks (need_id, as_at, trained, reported_by_name, note)
  SELECT n.id, v.as_at, v.trained, v.who, v.note
  FROM (VALUES
    -- Round one
    ('Billing Operations', 'New Billing Console — core', DATE '2026-11-30', 110, 'D. Okafor',    NULL),
    ('Billing Operations', 'Exception queue handling',   DATE '2026-11-30', 60,  'D. Okafor',    'Runs after the core module.'),
    ('Contact Centre',     'Single Customer View',       DATE '2026-11-30', 95,  'S. Whitcombe', NULL),
    ('Finance',            'Month-end reconciliation',   DATE '2026-11-30', 0,   'A. Nguyen',    'Starts with the January parallel run.'),
    -- Round two
    ('Billing Operations', 'New Billing Console — core', DATE '2026-12-14', 158, 'D. Okafor',    'Two sessions left.'),
    ('Billing Operations', 'Exception queue handling',   DATE '2026-12-14', 120, 'D. Okafor',    NULL),
    ('Contact Centre',     'Single Customer View',       DATE '2026-12-14', 98,  'S. Whitcombe', 'Roster pressure — three sessions cancelled.'),
    ('Finance',            'Month-end reconciliation',   DATE '2026-12-14', 0,   'A. Nguyen',    'Unchanged, as planned.'),
    -- Answered, but the answer is "I do not know yet". Distinct from never asked.
    ('Contact Centre',     'Day-one support briefing',   DATE '2026-12-14', NULL,'S. Whitcombe', 'Not scheduled yet.')
    -- Deliberately absent: every Field Services row (no owner, nobody to ask) and
    -- Refund Processing (material still in build).
  ) AS v(audience, module, as_at, trained, who, note)
  JOIN public.audiences       a ON a.project_id = v_project AND a.name = v.audience
  JOIN public.training_modules m ON m.project_id = v_project AND m.name = v.module
  JOIN public.training_needs  n ON n.audience_id = a.id AND n.module_id = m.id
  ON CONFLICT (need_id, as_at) DO UPDATE SET trained = EXCLUDED.trained, note = EXCLUDED.note;
END $$;

-- Note the gap_reason column: every blank percentage says WHY it is blank.
SELECT audience_name, module_name,
       COALESCE(people_needed::text, '—')  AS needed,
       COALESCE(trained::text, '—')        AS trained,
       COALESCE(pct::text, '—')            AS pct,
       COALESCE(gap_reason, 'ok')          AS reason,
       COALESCE(last_checked::text, 'never') AS last_checked
FROM public.training_coverage
WHERE project_id = (SELECT p.id FROM public.projects p JOIN public.clients c ON c.id = p.client_id
                    WHERE c.name = 'Meridian Water Corporation (Demo)' LIMIT 1)
ORDER BY audience_name, module_name;
