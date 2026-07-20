-- ChangeFlow: per-domain impact on audiences — the heat map becomes capturable.
--
-- THE GAP THIS CLOSES
--   The stakeholder heat map has existed as a renderer and a CORA intent for weeks, but
--   only ever had data because one was hand-authored into change_artifacts. A real client
--   had no way to produce one — there was no capture step, which is why the heat map has
--   sat deferred in the backlog.
--
--   Audiences already carry an overall impact_level. Adding a rating per domain turns the
--   table a client fills in anyway into a genuine heat map, with no separate exercise.
--
-- WHY FOUR COLUMNS RATHER THAN A JSONB BLOB
--   The domains are fixed by the methodology (People, Process, Information, Technology),
--   they are queryable this way, and a CHECK constraint keeps the values honest. A blob
--   would allow 'High', 'high' and 'HIGH' into the same column and nothing would notice.
--
-- Safe to re-run.

ALTER TABLE public.audiences
  ADD COLUMN IF NOT EXISTS impact_people      text CHECK (impact_people      IN ('vh','h','m','l','vl','none')),
  ADD COLUMN IF NOT EXISTS impact_process     text CHECK (impact_process     IN ('vh','h','m','l','vl','none')),
  ADD COLUMN IF NOT EXISTS impact_information text CHECK (impact_information IN ('vh','h','m','l','vl','none')),
  ADD COLUMN IF NOT EXISTS impact_technology  text CHECK (impact_technology  IN ('vh','h','m','l','vl','none')),
  -- Free text on why this group is rated as it is. The heat map's commentary line has
  -- always been the most useful part of it and was previously only authorable by hand.
  ADD COLUMN IF NOT EXISTS impact_note        text,
  ADD COLUMN IF NOT EXISTS impact_rated_on    date;

-- ─────────────────────────────────────────────────────────────
-- Seed the demo client's ratings to match the existing artifact
-- ─────────────────────────────────────────────────────────────
-- Same numbers as the hand-authored heat map, so the two agree while both exist and the
-- switchover is invisible. Field Services keeps its unknown headcount but IS rated —
-- not knowing how many people are in a group doesn't stop you assessing the impact on it.
DO $$
DECLARE v_project uuid;
BEGIN
  SELECT p.id INTO v_project
  FROM public.projects p JOIN public.clients c ON c.id = p.client_id
  WHERE c.name = 'Meridian Water Corporation (Demo)' LIMIT 1;

  IF v_project IS NULL THEN
    RAISE NOTICE 'Meridian demo project not found — columns added, seed skipped.';
    RETURN;
  END IF;

  UPDATE public.audiences SET
    impact_people = v.p, impact_process = v.pr, impact_information = v.i, impact_technology = v.t,
    impact_note = v.note, impact_rated_on = DATE '2026-06-12'
  FROM (VALUES
    ('Billing Operations',       'vh','vh','h', 'h',  'Role, process and system all move together — the pivot of this change.'),
    ('Contact Centre',           'h', 'h', 'h', 'm',  'New scripts and a single customer view; shares the go-live week.'),
    ('Field Services',           'm', 'm', 'l', 'h',  'Mobile app replaces paper forms; process barely changes.'),
    ('Finance',                  'l', 'h', 'm', 'l',  'Month-end reconciliation automates; the rest is unchanged.'),
    ('Information & Technology', 'l', 'm', 'h', 'vh', 'Builds the change rather than absorbing it.')
  ) AS v(name, p, pr, i, t, note)
  WHERE audiences.project_id = v_project AND audiences.name = v.name;
END $$;

SELECT name,
       COALESCE(impact_people,'—')      AS people,
       COALESCE(impact_process,'—')     AS process,
       COALESCE(impact_information,'—') AS information,
       COALESCE(impact_technology,'—')  AS technology
FROM public.audiences
WHERE project_id = (SELECT p.id FROM public.projects p JOIN public.clients c ON c.id = p.client_id
                    WHERE c.name = 'Meridian Water Corporation (Demo)' LIMIT 1)
ORDER BY sort_order;
