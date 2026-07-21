-- ChangeFlow · DEMO CLIENT — a two-phase programme
-- =============================================================================
--   Client   : Kestrel Health (Demo)
--   Project  : Patient Records Uplift
--   Scope    : Diagnose + Design only. Engage, Embed and Evaluate are a later
--              programme and are NOT in a lane, so they are not being run.
--
-- WHY THIS EXISTS SEPARATELY FROM MERIDIAN
--   Meridian runs all five phases and is the full-feature demo. This one exists to
--   exercise the case Meridian cannot: a client who picks part of the methodology.
--   Keeping them apart means the new maths can be checked against a known answer
--   without disturbing the demo everything else has been tested on.
--
-- THE NUMBERS ARE CHOSEN SO THEY CAN BE CHECKED BY HAND
--   Diagnose: 4 exercises, all complete            → 100%
--   Design:   5 exercises, 1 complete              →  20%
--   Two phases in scope, equal weight              →  60% overall
--
--   Under the OLD maths this project would have read 5 of 9 completions across all
--   five phases = 56%, and would have counted three phases nobody is running. The
--   difference between 60% and 56% is small here on purpose — the point is that one
--   number answers "how far through our programme are we" and the other does not.
--
-- THE QUIET PERIOD IS DELIBERATE
--   Diagnose ends 30 Sep, Design starts 3 Nov. Five weeks of planned gap. Progress
--   is genuinely flat across it, and a straight-line trend reads that as stalling.
--   This is the case that motivated the whole change, so the demo has to contain it.
--
-- Safe to re-run: deletes and recreates its own client first.
-- =============================================================================

DO $$
DECLARE
  v_client  uuid;
  v_project uuid;
  v_owner   uuid;
  v_lane    uuid;
  v_member  uuid;
BEGIN
  -- Reuse whichever profile is already the owner elsewhere; this seed creates no users.
  SELECT id INTO v_owner FROM public.profiles ORDER BY created_at LIMIT 1;
  IF v_owner IS NULL THEN
    RAISE EXCEPTION 'No profiles exist — sign in at least once before seeding.';
  END IF;

  DELETE FROM public.clients WHERE name = 'Kestrel Health (Demo)';

  INSERT INTO public.clients (name, industry, contact_name, contact_email, is_active)
  VALUES ('Kestrel Health (Demo)', 'Healthcare', 'Alex Mercer', 'alex.mercer@kestrelhealth.example', true)
  RETURNING id INTO v_client;

  INSERT INTO public.projects (client_id, name, description, user_id)
  VALUES (v_client, 'Patient Records Uplift',
          'Consolidating three patient record systems. Diagnose and Design run now; delivery and embedding are a separate programme next financial year.',
          v_owner)
  RETURNING id INTO v_project;

  INSERT INTO public.project_members (project_id, user_id) VALUES (v_project, v_owner);
  v_member := v_owner;

  -- ── Phases ────────────────────────────────────────────────────────────────
  -- All five exist. The methodology is not being altered — only two are being run.
  INSERT INTO public.project_phases (project_id, phase_number, status, planned_start, planned_end) VALUES
    (v_project, 1, 'complete', DATE '2026-08-03', DATE '2026-09-30'),
    (v_project, 2, 'active',   DATE '2026-11-03', DATE '2026-12-18'),   -- 5-week gap before this
    (v_project, 3, 'locked',   NULL, NULL),
    (v_project, 4, 'locked',   NULL, NULL),
    (v_project, 5, 'locked',   NULL, NULL);

  -- ── The lane IS the scope ────────────────────────────────────────────────
  -- Only phases 1 and 2 join it. Phases 3-5 sit in no lane, which is how the
  -- platform knows they are not part of this programme.
  INSERT INTO public.project_lanes (project_id, name, tint, sort_order)
  VALUES (v_project, 'Wave 1 — Assess & Design', '#eff6ff', 0)
  RETURNING id INTO v_lane;

  UPDATE public.project_phases SET lane_id = v_lane
  WHERE project_id = v_project AND phase_number IN (1, 2);

  -- ── Exercises: 4 in Diagnose, 5 in Design ────────────────────────────────
  -- Counts chosen so the weights are round: 25% each in Diagnose, 20% each in Design.
  INSERT INTO public.phase_content
    (phase_number, industry, role, content_type, title, description, is_common, sort_order, client_id) VALUES
    (1, 'Healthcare', NULL, 'exercise', 'Current-state records audit',
     'Catalogue what each of the three systems holds, and where the same patient appears more than once.', false, 10, v_client),
    (1, 'Healthcare', NULL, 'exercise', 'Clinician workflow shadowing',
     'Sit with ward staff across two sites to see how records are actually used, not how the manual says.', false, 20, v_client),
    (1, 'Healthcare', NULL, 'exercise', 'Data quality baseline',
     'Sample 500 records for completeness and duplication so the uplift has a number to improve on.', false, 30, v_client),
    (1, 'Healthcare', NULL, 'exercise', 'Stakeholder and impact mapping',
     'Who is affected, how much, and who speaks for each group.', false, 40, v_client),

    (2, 'Healthcare', NULL, 'exercise', 'Target record model workshop',
     'Agree the single patient record structure with clinical, admin and IT representatives.', false, 10, v_client),
    (2, 'Healthcare', NULL, 'exercise', 'Migration approach options',
     'Big-bang against phased migration, assessed for clinical risk and downtime.', false, 20, v_client),
    (2, 'Healthcare', NULL, 'exercise', 'Consent and privacy review',
     'What consolidation means for patient consent, reviewed with the privacy officer.', false, 30, v_client),
    (2, 'Healthcare', NULL, 'exercise', 'Future-state process design',
     'Redesign admission, transfer and discharge against the single record.', false, 40, v_client),
    (2, 'Healthcare', NULL, 'exercise', 'Design sign-off pack',
     'The pack the clinical governance committee signs before build is commissioned.', false, 50, v_client);

  -- Phases 3-5 get no content, which is correct: nothing has been authored for work
  -- that is not being done. Under the new maths they have no percentage rather than
  -- a zero, and they are out of scope anyway.

  -- ── Pathway ──────────────────────────────────────────────────────────────
  INSERT INTO public.project_pathways
    (project_id, phase_number, content_id, pathway_step, starts_on, ends_on, lane_id, sort_order)
  SELECT v_project, c.phase_number, c.id,
         row_number() OVER (PARTITION BY c.phase_number ORDER BY c.sort_order),
         CASE c.phase_number WHEN 1 THEN DATE '2026-08-03' ELSE DATE '2026-11-03' END
           + (c.sort_order / 10 - 1) * 11,
         CASE c.phase_number WHEN 1 THEN DATE '2026-08-03' ELSE DATE '2026-11-03' END
           + (c.sort_order / 10 - 1) * 11 + 9,
         v_lane, c.sort_order
  FROM public.phase_content c WHERE c.client_id = v_client;

  -- ── Completions: all 4 of Diagnose, 1 of 5 in Design ─────────────────────
  INSERT INTO public.user_activities (user_id, content_id, phase_number, status, completed_at)
  SELECT v_member, c.id, c.phase_number, 'completed',
         CASE c.phase_number WHEN 1 THEN TIMESTAMPTZ '2026-09-20' ELSE TIMESTAMPTZ '2026-11-14' END
  FROM public.phase_content c
  WHERE c.client_id = v_client
    AND (c.phase_number = 1 OR (c.phase_number = 2 AND c.sort_order = 10));

  -- ── Audiences, so the heat map and training aspects have something ───────
  INSERT INTO public.audiences (project_id, name, headcount, owner_name, notes, sort_order,
                                impact_people, impact_process, impact_information, impact_technology,
                                impact_note, impact_rated_on) VALUES
    (v_project, 'Ward Nursing',    240, 'J. Halloran', 'Uses records at every handover.', 0,
     'h','h','vh','m', 'Record structure changes at the point of care.', DATE '2026-09-15'),
    (v_project, 'Admissions',       60, 'R. Okonkwo',  'Creates the record.', 1,
     'vh','vh','h','h', 'The whole intake process is redesigned.', DATE '2026-09-15'),
    (v_project, 'Clinical Coding',  35, NULL,          'Headcount confirmed, owner not yet named.', 2,
     'm','h','vh','l', 'Coding against one record instead of three.', DATE '2026-09-15');

  RAISE NOTICE 'Kestrel Health seeded: project %, lane %', v_project, v_lane;
END $$;

-- ─────────────────────────────────────────────────────────────
-- Check the numbers by hand
-- ─────────────────────────────────────────────────────────────
-- Expect: Diagnose 4 of 4 (100%), Design 1 of 5 (20%), phases 3-5 not in scope.
-- Overall should read 60% under the new maths, once loadData() uses projectProgress.
SELECT
  s.phase_number,
  CASE s.phase_number WHEN 1 THEN 'Diagnose' WHEN 2 THEN 'Design' WHEN 3 THEN 'Engage'
                      WHEN 4 THEN 'Embed'    ELSE 'Evaluate' END AS phase,
  s.in_scope,
  coalesce(s.lane_name, '—') AS lane,
  count(c.id)                                        AS exercises,
  count(ua.id)                                       AS completed,
  CASE WHEN count(c.id) = 0 THEN '—'
       ELSE round(100.0 * count(ua.id) / count(c.id))::text || '%' END AS phase_pct
FROM public.project_phase_scope s
JOIN public.projects p       ON p.id = s.project_id
JOIN public.clients cl       ON cl.id = p.client_id AND cl.name = 'Kestrel Health (Demo)'
LEFT JOIN public.phase_content c  ON c.client_id = cl.id AND c.phase_number = s.phase_number
LEFT JOIN public.user_activities ua ON ua.content_id = c.id
GROUP BY s.phase_number, s.in_scope, s.lane_name
ORDER BY s.phase_number;
