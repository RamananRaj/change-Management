-- ChangeFlow · demo artifacts for Meridian: impact heat map, readiness gate, comms plan.
--
-- All three live in change_artifacts (client-scoped, typed, JSONB payload), so no new
-- tables are needed to demonstrate them. The heat map renders through the existing
-- heatmap widget; the gate and comms plan render through the list widget via the
-- new `gates` and `comms` intents.
--
-- This is demo data for a fictional client. Run seed_demo_client.sql first.
-- Safe to re-run.

DO $$
DECLARE v_client uuid; v_project uuid;
BEGIN
  SELECT id INTO v_client FROM public.clients WHERE name = 'Meridian Water Corporation (Demo)';
  IF v_client IS NULL THEN
    RAISE EXCEPTION 'Run seed_demo_client.sql first — Meridian client not found.';
  END IF;
  SELECT id INTO v_project FROM public.projects WHERE client_id = v_client LIMIT 1;

  DELETE FROM public.change_artifacts WHERE client_id = v_client;

  -- ── 1. Stakeholder impact heat map ──────────────────────────────────────────
  -- Levels: vh | h | m | l | vl | none. Billing Operations is the pivot: the whole
  -- role changes. I&T is high on technology but low on people — it builds the change
  -- rather than absorbing it, which is exactly the distinction a heat map should show.
  INSERT INTO public.change_artifacts (client_id, project_id, type, title, version, is_current, source, data)
  VALUES (v_client, v_project, 'stakeholder_heatmap', 'Stakeholder impact heat map', 1, true,
          'Impact assessment workshop · 12 Jun 2026',
          '{
            "cols": ["People", "Process", "Information", "Technology"],
            "rows": [
              { "label": "Billing Operations",       "cells": ["vh", "vh", "h",  "h"]  },
              { "label": "Contact Centre",           "cells": ["h",  "h",  "h",  "m"]  },
              { "label": "Field Services",           "cells": ["m",  "m",  "l",  "h"]  },
              { "label": "Finance",                  "cells": ["l",  "h",  "m",  "l"]  },
              { "label": "Information & Technology", "cells": ["l",  "m",  "h",  "vh"] }
            ],
            "commentary": "Billing Operations absorbs the change end to end — role, process and system all move together. Contact Centre is close behind and shares the go-live week."
          }'::jsonb);

  -- ── 2. Change impact assessment (detail behind the heat map) ────────────────
  INSERT INTO public.change_artifacts (client_id, project_id, type, title, version, is_current, source, data)
  VALUES (v_client, v_project, 'change_impact', 'Change impact assessment', 1, true,
          'Future state walkthrough · 26 Jun 2026',
          '{
            "rows": [
              { "process": "Bill generation",    "role": "Billing Officer",   "severity": "Very High", "current": "Manual overnight batch with morning exception review", "future": "Real-time generation; exceptions queue in the new console", "mitigation": "Classroom training plus two weeks floor-walking" },
              { "process": "Customer enquiry",   "role": "Contact Centre",    "severity": "High",      "current": "Two systems, manual cross-reference",                  "future": "Single customer view",                                    "mitigation": "New scripts and a quick-reference card" },
              { "process": "Meter exception",    "role": "Field Technician",  "severity": "Medium",    "current": "Paper form, keyed in later",                           "future": "Captured in the mobile app on site",                      "mitigation": "In-app guidance; no classroom needed" },
              { "process": "Month-end close",    "role": "Finance Analyst",   "severity": "High",      "current": "Manual reconciliation across three reports",           "future": "Automated reconciliation with an exception report",       "mitigation": "Parallel run for one cycle" }
            ]
          }'::jsonb);

  -- ── 3. Business readiness gate ──────────────────────────────────────────────
  -- Two reds and one unassessed unit, so the demo shows a gate that is NOT a clean
  -- pass. A gate where everything is green demonstrates nothing.
  INSERT INTO public.change_artifacts (client_id, project_id, type, title, version, is_current, source, data)
  VALUES (v_client, v_project, 'readiness_gate', 'Go-live readiness gate', 1, true,
          'Readiness review · 12 Nov 2026',
          '{
            "gate_name": "Go-live readiness",
            "decision_due": "2027-01-29",
            "owner": "Priya Raman",
            "verdict": "conditional",
            "units": [
              { "unit": "Billing Operations",       "met": 6, "total": 6, "status": "ready",        "owner": "D. Okafor",     "updated": "2026-11-12", "open": null },
              { "unit": "Contact Centre",           "met": 4, "total": 6, "status": "at_risk",      "owner": "S. Whitcombe",  "updated": "2026-11-10", "open": "Scripts blocked on vendor; hypercare roster has no owner" },
              { "unit": "Field Services",           "met": 6, "total": 6, "status": "ready",        "owner": "M. Reilly",     "updated": "2026-11-12", "open": null },
              { "unit": "Finance",                  "met": 5, "total": 6, "status": "watch",        "owner": "A. Nguyen",     "updated": "2026-11-11", "open": "Month-end parallel run not yet scheduled" },
              { "unit": "Information & Technology", "met": 2, "total": 6, "status": "not_assessed", "owner": null,            "updated": null,         "open": "Assessment not started" }
            ]
          }'::jsonb);

  -- ── 4. Comms plan ───────────────────────────────────────────────────────────
  -- Each item is anchored to a milestone with an offset, not a bare date, so moving
  -- Go-Live moves the cascade. One item is blocked on an unfinished phase output.
  INSERT INTO public.change_artifacts (client_id, project_id, type, title, version, is_current, source, data)
  VALUES (v_client, v_project, 'comms_plan', 'Comms plan', 1, true,
          'Derived from timeline and phase outputs',
          '{
            "anchor": "Go-Live",
            "anchor_date": "2027-02-15",
            "items": [
              { "offset": -180, "date": "2026-08-19", "audience": "All impacted staff",   "size": 480, "channel": "Email",            "message": "What is changing and why",     "owner": "P. Raman",     "status": "sent",      "source": "Diagnose · impact assessment" },
              { "offset": -150, "date": "2026-09-18", "audience": "People leaders",       "size": 22,  "channel": "Briefing",         "message": "Leader talking points",        "owner": "P. Raman",     "status": "sent",      "source": "Engage · stakeholder map" },
              { "offset": -90,  "date": "2026-11-17", "audience": "Contact Centre",       "size": 140, "channel": "Email",            "message": "Training enrolment reminder",  "owner": null,           "status": "blocked",   "source": "Embed · training needs list is 55% complete" },
              { "offset": -30,  "date": "2027-01-16", "audience": "Billing Operations",   "size": 180, "channel": "Team meeting",     "message": "Day one walkthrough",          "owner": "D. Okafor",    "status": "planned",   "source": "anchored to Go-Live" },
              { "offset": -7,   "date": "2027-02-08", "audience": "All impacted staff",   "size": 480, "channel": "Email + intranet", "message": "What happens on day one",      "owner": "P. Raman",     "status": "planned",   "source": "anchored to Go-Live" },
              { "offset": 1,    "date": "2027-02-16", "audience": "All impacted staff",   "size": 480, "channel": "Email",            "message": "Where to get help",            "owner": "S. Whitcombe", "status": "planned",   "source": "anchored to Go-Live · hypercare" }
            ]
          }'::jsonb);


  -- ── 5. Extra scenarios ──────────────────────────────────────────────────────
  -- A demo where everything is amber teaches nothing. These add the edge cases a
  -- change lead actually hits, so each renderer can be seen handling them.

  -- 5a. A SUPERSEDED heat map (version 1 is not current) — proves versioning shows.
  UPDATE public.change_artifacts SET version = 2 WHERE client_id = v_client AND type = 'stakeholder_heatmap';
  INSERT INTO public.change_artifacts (client_id, project_id, type, title, version, is_current, source, data)
  VALUES (v_client, v_project, 'stakeholder_heatmap', 'Stakeholder impact heat map', 1, false,
          'Initial draft · 04 May 2026',
          '{
            "cols": ["People", "Process", "Information", "Technology"],
            "rows": [
              { "label": "Billing Operations",       "cells": ["h",  "h",  "m", "m"] },
              { "label": "Contact Centre",           "cells": ["m",  "m",  "m", "l"] },
              { "label": "Field Services",           "cells": ["l",  "l",  "l", "m"] },
              { "label": "Finance",                  "cells": ["l",  "m",  "l", "l"] },
              { "label": "Information & Technology", "cells": ["l",  "m",  "m", "h"] }
            ],
            "commentary": "First pass, before the future-state walkthrough. Impact was materially understated."
          }'::jsonb);

  -- 5b. Issues and decisions — the two things a real programme update needs that
  --     nothing in ChangeFlow captures yet. Stored as artifacts so the narrative
  --     has something true to say instead of stopping at progress and risk.
  INSERT INTO public.change_artifacts (client_id, project_id, type, title, version, is_current, source, data)
  VALUES (v_client, v_project, 'issues_log', 'Issues and decisions', 1, true, 'Programme board · 12 Nov 2026',
          '{
            "issues": [
              { "ref": "I-014", "raised": "2026-10-28", "severity": "high",   "status": "open",     "owner": "S. Whitcombe", "title": "Contact-centre scripts blocked on vendor", "detail": "Vendor has not returned the revised call flows. Blocks training content and the T-90 comm.", "impact": "Contact Centre" },
              { "ref": "I-011", "raised": "2026-10-06", "severity": "medium", "status": "open",     "owner": "A. Nguyen",    "title": "Month-end parallel run unscheduled",       "detail": "Finance cannot confirm readiness without one full parallel cycle.", "impact": "Finance" },
              { "ref": "I-009", "raised": "2026-09-14", "severity": "high",   "status": "resolved", "owner": "D. Okafor",    "title": "Billing exception queue design rejected",   "detail": "Reworked after the future-state walkthrough; signed off 02 Oct.", "impact": "Billing Operations" },
              { "ref": "I-016", "raised": "2026-11-09", "severity": "low",    "status": "open",     "owner": null,           "title": "I&T readiness assessment not started",      "detail": "No owner nominated for the I&T gate criteria.", "impact": "Information & Technology" }
            ],
            "decisions": [
              { "ref": "D-006", "date": "2026-10-02", "status": "agreed",  "title": "Two-release approach confirmed", "detail": "Release 1 billing engine, release 2 customer portal. Reduces go-live blast radius.", "owner": "Programme board" },
              { "ref": "D-008", "date": "2026-11-12", "status": "pending", "title": "Hypercare staffing model",       "detail": "Floor-walking vs central hotline. Needed before the January gate.", "owner": "P. Raman" }
            ]
          }'::jsonb);

  -- 5c. A second, DEFERRED comms item and an overdue one, so the comms renderer
  --     shows every status it supports rather than only sent/planned/blocked.
  UPDATE public.change_artifacts
  SET data = jsonb_set(data, '{items}', (data->'items') || '[
        { "offset": -120, "date": "2026-10-18", "audience": "Field Services", "size": 90, "channel": "Toolbox talk", "message": "Mobile app changes preview", "owner": "M. Reilly", "status": "overdue",  "source": "anchored to Go-Live" },
        { "offset": -60,  "date": "2026-12-17", "audience": "Finance",        "size": 45, "channel": "Email",        "message": "Month-end process changes",   "owner": "A. Nguyen", "status": "deferred", "source": "deferred pending parallel run (I-011)" }
      ]'::jsonb)
  WHERE client_id = v_client AND type = 'comms_plan';

  RAISE NOTICE 'Meridian artifacts seeded.';
END $$;

SELECT type, title, version FROM public.change_artifacts
WHERE client_id = (SELECT id FROM public.clients WHERE name = 'Meridian Water Corporation (Demo)')
ORDER BY type;
