-- ChangeFlow · DEMO CLIENT SEED
-- =============================================================================
-- Creates a self-contained demo client so CORA can be exercised against a full,
-- realistic data set without touching any real customer record.
--
--   Client   : Meridian Water Corporation (Demo)
--   Project  : Customer Billing Transformation
--   Timeline : Jul 2026 → Mar 2027, mid-flight as at Jul 2026
--
-- WHAT THIS DOES NOT DO
--   It creates no auth users. Members are taken from profiles that already
--   exist (see the MEMBERS block below — set the emails there).
--
-- TWO TABLES ARE GLOBAL, NOT CLIENT-SCOPED, so rows land in every client's list:
--   • stakeholders  — seeded names are prefixed "Meridian ·" so they're obvious
--   • surveys       — seeded survey is titled "Meridian Demo ·" for the same reason
--   phase_content and templates ARE client-scoped, so those stay contained.
--
-- TEARDOWN: see seed_demo_client_teardown.sql — deleting the client cascades to
-- the project, phases, lanes, milestones, pathway, content and templates, but
-- NOT to the two global tables above; the teardown handles those separately.
--
-- Safe to re-run: it deletes and recreates its own client first.
-- =============================================================================

DO $$
DECLARE
  v_client   uuid;
  v_project  uuid;
  v_owner    uuid;
  v_lane_del uuid;
  v_lane_chg uuid;
  v_lane_comms uuid;
  v_lane_train uuid;
  v_survey   uuid;
  v_members  uuid[];
  v_uid      uuid;
  v_cid      uuid;
  v_i        int;
  v_done     int;
  v_total    int;
BEGIN

  -- ── clean any previous run ────────────────────────────────────────────────
  DELETE FROM public.clients WHERE name = 'Meridian Water Corporation (Demo)';
  DELETE FROM public.stakeholders WHERE name LIKE 'Meridian ·%';
  DELETE FROM public.surveys WHERE title LIKE 'Meridian Demo ·%';

  -- ── 1. client ─────────────────────────────────────────────────────────────
  INSERT INTO public.clients (name, industry, contact_name, contact_email, notes, is_active)
  VALUES ('Meridian Water Corporation (Demo)', 'Utilities & Energy',
          'Priya Raman', 'priya.raman@meridianwater.example',
          'Demonstration client. All data is fabricated for showing ChangeFlow and CORA.',
          true)
  RETURNING id INTO v_client;

  -- ── 2. project ────────────────────────────────────────────────────────────
  -- projects.user_id is NOT NULL (the owning admin). The SQL editor runs as
  -- postgres with no auth.uid(), so it has to be resolved explicitly.
  SELECT id INTO v_owner FROM public.profiles WHERE email = 'ram.raj@ramraj.com.au';
  IF v_owner IS NULL THEN
    SELECT id INTO v_owner FROM public.profiles WHERE is_admin = true ORDER BY created_at LIMIT 1;
  END IF;
  IF v_owner IS NULL THEN
    RAISE EXCEPTION 'No owning profile found. Set an email that exists in public.profiles.';
  END IF;

  INSERT INTO public.projects (name, user_id, client_id, description, status)
  VALUES ('Customer Billing Transformation', v_owner, v_client,
          'Replacing the legacy billing platform and moving 480 staff to a new customer service model.',
          'active')
  RETURNING id INTO v_project;

  -- ── 3. phases — mid-flight: 1 done, 2 done, 3 running, 4-5 ahead ──────────
  INSERT INTO public.project_phases (project_id, phase_number, status, planned_start, planned_end) VALUES
    (v_project, 1, 'completed', '2026-04-06', '2026-05-15'),
    (v_project, 2, 'completed', '2026-05-18', '2026-06-26'),
    (v_project, 3, 'active',    '2026-06-29', '2026-08-28'),
    (v_project, 4, 'locked',    '2026-08-31', '2026-11-27'),
    (v_project, 5, 'locked',    '2026-11-30', '2027-02-26');

  -- ── 4. swimlanes ──────────────────────────────────────────────────────────
  INSERT INTO public.project_lanes (project_id, name, tint, sort_order)
  VALUES (v_project, 'Delivery', '#eff6ff', 0) RETURNING id INTO v_lane_del;
  INSERT INTO public.project_lanes (project_id, name, tint, sort_order)
  VALUES (v_project, 'Change', '#f0fdfa', 1) RETURNING id INTO v_lane_chg;
  INSERT INTO public.project_lanes (project_id, parent_id, name, tint, sort_order)
  VALUES (v_project, v_lane_chg, 'Comms', '#f8fafc', 0) RETURNING id INTO v_lane_comms;
  INSERT INTO public.project_lanes (project_id, parent_id, name, tint, sort_order)
  VALUES (v_project, v_lane_chg, 'Training', '#f8fafc', 1) RETURNING id INTO v_lane_train;

  -- ── 5. timeline items ─────────────────────────────────────────────────────
  -- Delivery: bands carry a manual pct; Go-Live shares line 2 with the UAT band.
  INSERT INTO public.project_milestones
    (project_id, lane_id, lane, name, starts_on, ends_on, milestone_date, color, sort_order, pct) VALUES
    (v_project, v_lane_del, 'delivery', 'Design authority sign-off', NULL, NULL, '2026-06-26', '#1F4E79', 0, 0),
    (v_project, v_lane_del, 'delivery', 'Build — release 1',   '2026-06-01', '2026-09-25', NULL, '#1F4E79', 1, 72),
    (v_project, v_lane_del, 'delivery', 'Build — release 2',   '2026-09-28', '2026-12-18', NULL, '#378ADD', 2, 0),
    (v_project, v_lane_del, 'delivery', 'UAT',                 '2027-01-04', '2027-02-12', NULL, '#E8913A', 3, 0),
    (v_project, v_lane_del, 'delivery', 'Go-Live',             NULL, NULL, '2027-02-15', '#dc2626', 3, 0),
    (v_project, v_lane_del, 'delivery', 'Hypercare',           '2027-02-16', '2027-03-27', NULL, '#64748b', 4, 0);

  INSERT INTO public.project_milestones
    (project_id, lane_id, lane, name, starts_on, ends_on, milestone_date, color, sort_order, pct) VALUES
    (v_project, v_lane_chg, 'change', 'Impact assessment',        '2026-05-18', '2026-07-10', NULL, '#0d9488', 0, 88),
    (v_project, v_lane_chg, 'change', 'Change champion network',  '2026-07-01', '2026-10-30', NULL, '#7c3aed', 1, 45),
    (v_project, v_lane_chg, 'change', 'Business readiness gate',  NULL, NULL, '2027-01-29', '#dc2626', 2, 0);

  INSERT INTO public.project_milestones
    (project_id, lane_id, lane, name, starts_on, ends_on, milestone_date, color, sort_order, pct) VALUES
    (v_project, v_lane_comms, 'change', 'Awareness campaign',   '2026-06-15', '2026-08-28', NULL, '#0891b2', 0, 60),
    (v_project, v_lane_comms, 'change', 'Leader briefings',     '2026-07-13', '2026-12-18', NULL, '#0891b2', 1, 30),
    (v_project, v_lane_comms, 'change', 'Go-live comms',        '2027-01-18', '2027-02-20', NULL, '#0891b2', 2, 0);

  INSERT INTO public.project_milestones
    (project_id, lane_id, lane, name, starts_on, ends_on, milestone_date, color, sort_order, pct) VALUES
    (v_project, v_lane_train, 'change', 'Training needs analysis', '2026-07-06', '2026-08-21', NULL, '#16a34a', 0, 55),
    (v_project, v_lane_train, 'change', 'Train the trainer',       '2026-10-05', '2026-11-13', NULL, '#16a34a', 1, 0),
    (v_project, v_lane_train, 'change', 'End-user training',       '2026-11-16', '2027-02-05', NULL, '#16a34a', 2, 0);

  -- ── 6. client-scoped content (kept out of the global library) ─────────────
  -- Deliberately client-scoped: completions below then can't inflate any other
  -- client's progress, because user_activities is keyed on user + content.
  INSERT INTO public.phase_content
    (phase_number, industry, role, content_type, title, description, is_common, sort_order, client_id) VALUES
    (1, 'Utilities & Energy', NULL, 'exercise', 'Billing pain-point interviews',
     'Structured interviews with 12 billing officers and 6 team leaders on where the legacy platform costs them time.', false, 10, v_client),
    (1, 'Utilities & Energy', NULL, 'template', 'Stakeholder map — billing transformation',
     'Power/interest grid across Billing Operations, Contact Centre, Field Services, Finance and IT.', false, 20, v_client),
    (1, 'Utilities & Energy', NULL, 'exercise', 'Change readiness baseline',
     'ADKAR baseline across the five impacted business units, run before design starts.', false, 30, v_client),

    (2, 'Utilities & Energy', NULL, 'template', 'Change impact assessment — current vs future',
     'Process-by-process assessment of what changes for each role, rated for severity.', false, 10, v_client),
    (2, 'Utilities & Energy', NULL, 'exercise', 'Future state process walkthrough',
     'Walk the new billing journey with representatives from each impacted unit and capture concerns.', false, 20, v_client),
    (2, 'Utilities & Energy', NULL, 'tool', 'Change approach one-pager',
     'The agreed approach for comms, training and reinforcement, signed off by the steering committee.', false, 30, v_client),

    (3, 'Utilities & Energy', NULL, 'exercise', 'Change champion recruitment',
     'Identify and onboard 18 champions across the five units; one per team of roughly 25.', false, 10, v_client),
    (3, 'Utilities & Energy', NULL, 'template', 'Comms plan — billing transformation',
     'Audience, channel, message and owner for every planned communication, anchored to Go-Live.', false, 20, v_client),
    (3, 'Utilities & Energy', NULL, 'exercise', 'Leader alignment workshop',
     'Half-day with the 22 people leaders to align on the story and surface their own concerns.', false, 30, v_client),
    (3, 'Utilities & Energy', NULL, 'tool', 'Resistance log',
     'Running log of objections raised, who raised them, and how each was addressed.', false, 40, v_client),

    (4, 'Utilities & Energy', NULL, 'template', 'Training needs analysis',
     'Role-by-capability matrix for 480 staff, mapping who needs which module.', false, 10, v_client),
    (4, 'Utilities & Energy', NULL, 'exercise', 'Train the trainer',
     'Certify 18 champions to deliver end-user training in their own teams.', false, 20, v_client),
    (4, 'Utilities & Energy', NULL, 'tool', 'Business readiness checklist',
     'Gate criteria per business unit, scored ahead of the January readiness gate.', false, 30, v_client),

    (5, 'Utilities & Energy', NULL, 'exercise', 'Post go-live pulse survey',
     'Two-week and six-week pulse on adoption and confidence across the five units.', false, 10, v_client),
    (5, 'Utilities & Energy', NULL, 'tool', 'Benefits realisation tracker',
     'Baseline, target and actual for call handling time, billing error rate and first-contact resolution.', false, 20, v_client);

  -- ── 7. pathway — content on the timeline, dated, in the right lane ────────
  -- Phases 1-2 are behind us so those activities are dated in the past.
  INSERT INTO public.project_pathways
    (project_id, phase_number, content_id, pathway_step, starts_on, ends_on, lane_id, sort_order)
  SELECT v_project, c.phase_number, c.id,
         row_number() OVER (PARTITION BY c.phase_number ORDER BY c.sort_order),
         CASE c.phase_number WHEN 1 THEN DATE '2026-04-06' WHEN 2 THEN DATE '2026-05-18'
                             WHEN 3 THEN DATE '2026-06-29' WHEN 4 THEN DATE '2026-08-31'
                             ELSE DATE '2026-11-30' END + (c.sort_order / 10 - 1) * 12,
         CASE c.phase_number WHEN 1 THEN DATE '2026-04-06' WHEN 2 THEN DATE '2026-05-18'
                             WHEN 3 THEN DATE '2026-06-29' WHEN 4 THEN DATE '2026-08-31'
                             ELSE DATE '2026-11-30' END + (c.sort_order / 10 - 1) * 12 + 18,
         CASE WHEN c.title ILIKE '%comms%' OR c.title ILIKE '%leader%' THEN v_lane_comms
              WHEN c.title ILIKE '%training%' OR c.title ILIKE '%trainer%' THEN v_lane_train
              ELSE v_lane_chg END,
         c.sort_order
  FROM public.phase_content c
  WHERE c.client_id = v_client;

  -- ── 8. client-scoped templates ───────────────────────────────────────────
  INSERT INTO public.templates (title, description, phase_number, industry, columns, sort_order, is_active, client_id)
  VALUES
    ('Stakeholder map — Meridian', 'Power/interest grid with engagement action per stakeholder.', 1, 'Utilities & Energy',
     '[{"key":"stakeholder_name","label":"Stakeholder","type":"text"},
       {"key":"unit","label":"Business unit","type":"text"},
       {"key":"influence","label":"Influence","type":"select","options":["High","Medium","Low"]},
       {"key":"interest","label":"Interest","type":"select","options":["High","Medium","Low"]},
       {"key":"sentiment","label":"Sentiment 1-5","type":"number"},
       {"key":"action","label":"Engagement action","type":"text"}]'::jsonb, 10, true, v_client),

    ('Change impact assessment — Meridian', 'What changes for each role, and how hard it lands.', 2, 'Utilities & Energy',
     '[{"key":"process","label":"Process","type":"text"},
       {"key":"role","label":"Role affected","type":"text"},
       {"key":"current_state","label":"Current state","type":"text"},
       {"key":"future_state","label":"Future state","type":"text"},
       {"key":"severity","label":"Severity","type":"select","options":["Very High","High","Medium","Low"]},
       {"key":"mitigation","label":"Mitigation","type":"text"}]'::jsonb, 10, true, v_client),

    ('Training needs analysis — Meridian', 'Who needs which module, and whether they have done it.', 4, 'Utilities & Energy',
     '[{"key":"role","label":"Role","type":"text"},
       {"key":"unit","label":"Business unit","type":"text"},
       {"key":"headcount","label":"Headcount","type":"number"},
       {"key":"module","label":"Module","type":"text"},
       {"key":"delivery","label":"Delivery method","type":"select","options":["Classroom","Virtual","E-learning","Floor-walking"]},
       {"key":"status","label":"Status","type":"select","options":["Not started","Scheduled","Complete"]}]'::jsonb, 10, true, v_client);

  -- ── 9. stakeholders (GLOBAL TABLE — prefixed so they are identifiable) ────
  INSERT INTO public.stakeholders (name, detail, is_active, sort_order) VALUES
    ('Meridian · Billing Operations',  'Demo client · 180 staff · highest impact, whole role changes', true, 900),
    ('Meridian · Contact Centre',      'Demo client · 140 staff · high impact, new scripts and systems', true, 901),
    ('Meridian · Field Services',      'Demo client · 90 staff · medium impact, mobile app changes', true, 902),
    ('Meridian · Finance',             'Demo client · 45 staff · medium impact, month-end process changes', true, 903),
    ('Meridian · Information & Tech',  'Demo client · 25 staff · low impact, supports the change', true, 904);

  -- ── 10. readiness survey (GLOBAL TABLE — prefixed) ───────────────────────
  INSERT INTO public.surveys (title, description, phase_number, rag_green_threshold, rag_amber_threshold, is_active, sort_order)
  VALUES ('Meridian Demo · Change readiness pulse',
          'Fortnightly pulse across the five impacted units. Demo data.', 3, 3.5, 2.5, true, 900)
  RETURNING id INTO v_survey;

  INSERT INTO public.survey_questions (survey_id, question_text, question_type, is_required, sort_order) VALUES
    (v_survey, 'I understand why the billing platform is changing', 'rating', true, 10),
    (v_survey, 'I know what it means for my day-to-day work',       'rating', true, 20),
    (v_survey, 'I feel I will have the skills I need by go-live',   'rating', true, 30),
    (v_survey, 'I know where to go with questions',                 'rating', true, 40),
    (v_survey, 'What would most help you right now?',               'text',  false, 50);

  -- ── 11. MEMBERS — existing profiles only, no accounts are created ─────────
  -- EDIT THESE EMAILS to whoever should appear as the project team.
  SELECT array_agg(id) INTO v_members
  FROM public.profiles
  WHERE email IN (
    'ram.raj@ramraj.com.au'
    -- , 'ujjwal@example.com'      -- add Ujjwal's address here
  );

  IF v_members IS NULL OR array_length(v_members, 1) IS NULL THEN
    RAISE NOTICE 'No matching profiles found — project created with no members. Edit the email list and re-run.';
  ELSE
    FOREACH v_uid IN ARRAY v_members LOOP
      INSERT INTO public.project_members (project_id, user_id)
      VALUES (v_project, v_uid) ON CONFLICT DO NOTHING;
    END LOOP;

    -- ── 12. completions — phases 1-2 fully done, phase 3 partly ────────────
    FOREACH v_uid IN ARRAY v_members LOOP
      FOR v_cid IN
        SELECT id FROM public.phase_content WHERE client_id = v_client AND phase_number <= 2
      LOOP
        INSERT INTO public.user_activities (user_id, content_id, phase_number, status, completed_at)
        SELECT v_uid, v_cid, c.phase_number, 'completed', now() - interval '30 days'
        FROM public.phase_content c WHERE c.id = v_cid
        ON CONFLICT (user_id, content_id) DO NOTHING;
      END LOOP;

      -- phase 3: the first two of four, so progress reads as genuinely partial
      FOR v_cid IN
        SELECT id FROM public.phase_content
        WHERE client_id = v_client AND phase_number = 3 ORDER BY sort_order LIMIT 2
      LOOP
        INSERT INTO public.user_activities (user_id, content_id, phase_number, status, completed_at)
        VALUES (v_uid, v_cid, 3, 'completed', now() - interval '6 days')
        ON CONFLICT (user_id, content_id) DO NOTHING;
      END LOOP;
    END LOOP;
  END IF;

  -- ── 13. progress history so Trend & velocity has something to draw ───────
  -- Twelve weekly points climbing 18% → 61%, with a deliberate flat spell in the
  -- middle: a perfectly straight line would make the trend chart look fabricated.
  SELECT count(*) INTO v_total FROM public.phase_content WHERE client_id = v_client;
  v_total := v_total * GREATEST(COALESCE(array_length(v_members, 1), 1), 1);

  FOR v_i IN 0..11 LOOP
    v_done := ROUND(v_total * (ARRAY[0.18,0.22,0.27,0.31,0.33,0.34,0.34,0.39,0.45,0.51,0.57,0.61])[v_i + 1]);
    INSERT INTO public.progress_snapshots
      (captured_on, client_id, project_id, members, total, done, pct, overdue)
    VALUES (current_date - ((11 - v_i) * 7), v_client, v_project,
            GREATEST(COALESCE(array_length(v_members, 1), 1), 1), v_total, v_done,
            ROUND(v_done::numeric / NULLIF(v_total, 0) * 100),
            CASE WHEN v_i >= 5 AND v_i <= 7 THEN 1 ELSE 0 END)
    ON CONFLICT (captured_on, project_id) DO NOTHING;
  END LOOP;

  RAISE NOTICE 'Demo client seeded. client_id=%, project_id=%', v_client, v_project;
END $$;

SELECT
  (SELECT name FROM public.clients WHERE name LIKE 'Meridian%') AS client,
  (SELECT count(*) FROM public.phase_content c JOIN public.clients cl ON cl.id = c.client_id WHERE cl.name LIKE 'Meridian%') AS content_items,
  (SELECT count(*) FROM public.project_milestones m JOIN public.projects p ON p.id = m.project_id JOIN public.clients cl ON cl.id = p.client_id WHERE cl.name LIKE 'Meridian%') AS timeline_items,
  (SELECT count(*) FROM public.project_lanes l JOIN public.projects p ON p.id = l.project_id JOIN public.clients cl ON cl.id = p.client_id WHERE cl.name LIKE 'Meridian%') AS lanes,
  (SELECT count(*) FROM public.progress_snapshots s JOIN public.clients cl ON cl.id = s.client_id WHERE cl.name LIKE 'Meridian%') AS trend_points;
