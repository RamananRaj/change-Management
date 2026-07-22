-- ChangeFlow · DEMO — Meridian comms plan as real, anchored rows
-- =============================================================================
-- Replaces the hand-authored comms_plan JSONB artifact with rows in comms_items, every
-- one anchored to the Go-Live milestone so the whole cascade moves when Go-Live moves.
--
-- The set is chosen to show every derived state against today (mid-2026):
--   · sent        — already gone out
--   · overdue     — past due, nothing blocking it, nobody sent it
--   · blocked     — past due, waiting on an upstream milestone not yet reached
--   · planned     — still ahead
--   · fixed date  — a newsletter pinned to a calendar date, not the milestone
--   · detached    — revised off its anchor by an admin override
--
-- Safe to re-run: clears Meridian's comms_items first.
-- =============================================================================
DO $$
DECLARE
  v_project uuid;
  v_golive  uuid;   -- anchor for the cascade
  v_champ   uuid;   -- an upstream output that is NOT yet reached (blocks)
  v_train   uuid;   -- upstream, further out
BEGIN
  SELECT p.id INTO v_project
  FROM public.projects p JOIN public.clients c ON c.id = p.client_id
  WHERE c.name LIKE 'Meridian%' ORDER BY p.created_at LIMIT 1;
  IF v_project IS NULL THEN
    RAISE NOTICE 'Meridian project not found — run seed_demo_client.sql first.';
    RETURN;
  END IF;

  SELECT id INTO v_golive FROM public.project_milestones
    WHERE project_id = v_project AND name = 'Go-Live' LIMIT 1;
  SELECT id INTO v_champ  FROM public.project_milestones
    WHERE project_id = v_project AND name = 'Change champion network' LIMIT 1;
  SELECT id INTO v_train  FROM public.project_milestones
    WHERE project_id = v_project AND name = 'End-user training' LIMIT 1;

  DELETE FROM public.comms_items WHERE project_id = v_project;

  -- offset_days are relative to Go-Live (2027-02-15). The derived date is computed by the
  -- view, so these are the ONLY dates stored — move Go-Live and every row below shifts.
  INSERT INTO public.comms_items
    (project_id, message, audience, size, channel, owner_name,
     anchor_milestone_id, offset_days, depends_on_milestone_id, sent, sent_on, sort_order) VALUES

    -- Sent — well before go-live, already out.
    (v_project, 'What is changing and why', 'All impacted staff', 480, 'Email', 'P. Raman',
     v_golive, -250, NULL, true, DATE '2026-06-10', 10),
    (v_project, 'Leader talking points', 'People leaders', 22, 'Briefing', 'P. Raman',
     v_golive, -220, NULL, true, DATE '2026-07-10', 20),

    -- Overdue — due 2026-07-15, nothing blocking it, no owner, not sent. The plain "late".
    (v_project, 'Awareness follow-up', 'All impacted staff', 480, 'Intranet', NULL,
     v_golive, -215, NULL, false, NULL, 30),

    -- Blocked — due 2026-07-19, waiting on the champion network (runs to 30 Oct, not yet
    -- reached). This is the case the whole feature exists for: it is not late, it is
    -- waiting on an upstream output.
    (v_project, 'Champion-led team briefings', 'Billing Operations', 180, 'Team meeting', 'D. Okafor',
     v_golive, -211, v_champ, false, NULL, 40),

    -- Planned — still ahead. Depends on training, which is also ahead, so simply planned.
    (v_project, 'Training enrolment reminder', 'Contact Centre', 140, 'Email', 'D. Okafor',
     v_golive, -90, v_train, false, NULL, 50),
    (v_project, 'What happens on day one', 'All impacted staff', 480, 'Email + intranet', 'P. Raman',
     v_golive, -7, NULL, false, NULL, 60),
    (v_project, 'Where to get help', 'All impacted staff', 480, 'Email', 'S. Whitcombe',
     v_golive, 1, NULL, false, NULL, 70);   -- hypercare, day after go-live

  -- Fixed-date item — a monthly newsletter that does not move with go-live.
  INSERT INTO public.comms_items
    (project_id, message, audience, size, channel, owner_name, fixed_date, sort_order)
  VALUES
    (v_project, 'Monthly programme newsletter', 'All impacted staff', 480, 'Newsletter', 'P. Raman',
     DATE '2026-08-03', 25);

  -- Detached — anchored to go-live at −30 (would derive 2027-01-16) but revised by the
  -- admin to a fixed override, so it no longer tracks the milestone. The plan flags it.
  INSERT INTO public.comms_items
    (project_id, message, audience, size, channel, owner_name,
     anchor_milestone_id, offset_days, override_date, sort_order)
  VALUES
    (v_project, 'Day-one walkthrough', 'Billing Operations', 180, 'Team meeting', 'D. Okafor',
     v_golive, -30, DATE '2027-01-20', 55);

  RAISE NOTICE 'Meridian comms seeded: 9 items anchored to Go-Live (project %).', v_project;
END $$;

-- ─────────────────────────────────────────────────────────────
-- Check — the derived status the demo will show today
-- ─────────────────────────────────────────────────────────────
-- Expect: 2 sent, 1 overdue, 1 blocked (Champion-led briefings, waiting on the champion
-- network), the rest planned, and Day-one walkthrough flagged detached.
SELECT cs.effective_date, cs.derived_status,
       cs.message, cs.audience, coalesce(cs.owner_name,'— no owner') AS owner,
       CASE WHEN cs.detached THEN 'revised — off anchor'
            WHEN cs.anchor_name IS NOT NULL THEN 'Go-Live ' || cs.offset_days || 'd'
            ELSE 'fixed date' END AS anchoring,
       coalesce(cs.depends_name, '—') AS waits_on
FROM public.comms_schedule cs
JOIN public.projects p ON p.id = cs.project_id
JOIN public.clients c ON c.id = p.client_id AND c.name LIKE 'Meridian%'
ORDER BY cs.effective_date NULLS LAST;
