-- ChangeFlow · STEP 1 — verify the scope chain against real data
-- =============================================================================
-- Everything about scope has been checked in isolation: the helper returns 60% for
-- Kestrel's numbers, the tests pass, the build is clean. What has NOT been checked is
-- that the database actually holds the shape those checks assumed.
--
-- This file asks the database the same questions the app asks, so the answers can be
-- compared against what the screen shows. Read-only — it changes nothing.
-- =============================================================================
-- ⚠ GROUP BY project id, NEVER project name.
--   Six different projects are called 'My First Project'. Grouping by name merges them
--   and every count comes out 6x, which looks exactly like duplicated rows. That false
--   alarm has now been raised twice from this same mistake. The id is the identity; the
--   name is a label that happens to repeat.
-- =============================================================================

-- ─────────────────────────────────────────────────────────────
-- 1. What is in scope, per project?
-- ─────────────────────────────────────────────────────────────
-- Expect: Kestrel Health = 2 in scope, 3 deferred. Everything else = 5 in scope
-- (the add_phase_lanes backfill put all five in a lane for existing projects).
--
-- If any OTHER project shows deferred phases, the backfill missed it and that project's
-- percentages are now being computed over a narrower denominator than intended.
SELECT c.name AS client, p.name AS project, p.id AS project_id,
       count(*) FILTER (WHERE ph.lane_id IS NOT NULL) AS in_scope,
       count(*) FILTER (WHERE ph.lane_id IS NULL)     AS deferred,
       string_agg(DISTINCT l.name, ', ')              AS lanes
FROM public.project_phases ph
JOIN public.projects p  ON p.id = ph.project_id
JOIN public.clients  c  ON c.id = p.client_id
LEFT JOIN public.project_lanes l ON l.id = ph.lane_id
GROUP BY c.name, p.name, p.id
ORDER BY c.name, p.name;

-- ─────────────────────────────────────────────────────────────
-- 2. The maths, computed in SQL rather than in JavaScript
-- ─────────────────────────────────────────────────────────────
-- Same rule as phaseProgress(): each exercise carries an equal share of its phase, and
-- an exercise counts as the FRACTION of assigned members who have completed it.
--
-- Two independent implementations agreeing is worth more than one implementation
-- tested against itself. If SQL and the screen disagree, one of them is wrong and we
-- need to know which before trusting either.
--
-- Expect for Kestrel: Diagnose 100%, Design 20%, phases 3-5 NULL (no exercises, and
-- out of scope anyway) — and NULL is the correct answer there, not 0.
WITH members AS (
  SELECT project_id, greatest(count(*), 1) AS seats
  FROM public.project_members GROUP BY project_id
),
ex AS (
  SELECT pw.project_id, pw.phase_number, pw.content_id,
         count(ua.id) AS done_by
  FROM public.project_pathways pw
  LEFT JOIN public.user_activities ua
         ON ua.content_id = pw.content_id AND ua.status = 'completed'
  GROUP BY pw.project_id, pw.phase_number, pw.content_id
)
SELECT c.name AS client, p.name AS project, p.id AS project_id, ph.phase_number,
       (ph.lane_id IS NOT NULL) AS in_scope,
       count(ex.content_id)     AS exercises,
       CASE WHEN count(ex.content_id) = 0 THEN NULL
            ELSE round(100.0 * sum(least(ex.done_by, m.seats)::numeric / m.seats)
                       / count(ex.content_id))
       END AS phase_pct
FROM public.project_phases ph
JOIN public.projects p ON p.id = ph.project_id
JOIN public.clients  c ON c.id = p.client_id
LEFT JOIN members m ON m.project_id = p.id
LEFT JOIN ex ON ex.project_id = ph.project_id AND ex.phase_number = ph.phase_number
WHERE c.name LIKE '%Kestrel%'
GROUP BY c.name, p.name, p.id, ph.phase_number, ph.lane_id, m.seats
ORDER BY ph.phase_number;

-- ─────────────────────────────────────────────────────────────
-- 3. The programme number
-- ─────────────────────────────────────────────────────────────
-- Selected phases split the programme equally, so this averages the IN-SCOPE phases
-- that have exercises. Expect 60% for Kestrel: (100 + 20) / 2.
--
-- If this says 36% instead, the average is being taken over all five phases and scope
-- is not reaching the denominator — which was the entire point of the change.
WITH members AS (
  SELECT project_id, greatest(count(*), 1) AS seats
  FROM public.project_members GROUP BY project_id
),
ex AS (
  SELECT pw.project_id, pw.phase_number, pw.content_id, count(ua.id) AS done_by
  FROM public.project_pathways pw
  LEFT JOIN public.user_activities ua
         ON ua.content_id = pw.content_id AND ua.status = 'completed'
  GROUP BY pw.project_id, pw.phase_number, pw.content_id
),
per_phase AS (
  SELECT ph.project_id, ph.phase_number,
         CASE WHEN count(ex.content_id) = 0 THEN NULL
              ELSE 100.0 * sum(least(ex.done_by, m.seats)::numeric / m.seats)
                   / count(ex.content_id)
         END AS pct
  FROM public.project_phases ph
  LEFT JOIN members m ON m.project_id = ph.project_id
  LEFT JOIN ex ON ex.project_id = ph.project_id AND ex.phase_number = ph.phase_number
  WHERE ph.lane_id IS NOT NULL                      -- lane membership IS scope
  GROUP BY ph.project_id, ph.phase_number
)
SELECT c.name AS client, p.name AS project, p.id AS project_id,
       count(*)                        AS phases_in_scope,
       count(pp.pct)                   AS phases_measurable,
       round(avg(pp.pct))              AS programme_pct
FROM per_phase pp
JOIN public.projects p ON p.id = pp.project_id
JOIN public.clients  c ON c.id = p.client_id
GROUP BY c.name, p.name, p.id
ORDER BY c.name, p.name;

-- ─────────────────────────────────────────────────────────────
-- 4. Content stranded on deferred phases
-- ─────────────────────────────────────────────────────────────
-- A phase can be deferred AFTER its content was planned. That content still exists and
-- still has dates. The timeline now hides it and says how much it is hiding; this is
-- the same question asked of the database, so the count on screen can be checked.
--
-- Expect zero rows for Kestrel (its seed only authored phases 1 and 2).
SELECT c.name AS client, p.name AS project, p.id AS project_id, pw.phase_number,
       count(*) AS stranded_activities
FROM public.project_pathways pw
JOIN public.project_phases ph
  ON ph.project_id = pw.project_id AND ph.phase_number = pw.phase_number
JOIN public.projects p ON p.id = pw.project_id
JOIN public.clients  c ON c.id = p.client_id
WHERE ph.lane_id IS NULL
GROUP BY c.name, p.name, p.id, pw.phase_number
ORDER BY c.name, pw.phase_number;

-- ─────────────────────────────────────────────────────────────
-- 5. Duplicate phase rows — the fault that would silently break the maths
-- ─────────────────────────────────────────────────────────────
-- The unique constraint should make this impossible now. Checked anyway, because if it
-- ever came back, every percentage would divide by the wrong number and nothing else
-- would complain. Expect zero rows.
SELECT p.id AS project_id, p.name AS project, ph.phase_number, count(*) AS rows_found
FROM public.project_phases ph
JOIN public.projects p ON p.id = ph.project_id
GROUP BY p.id, p.name, ph.phase_number      -- id, not name: see the warning at the top
HAVING count(*) > 1
ORDER BY p.name, ph.phase_number;

-- Sanity check on the above: how many DISTINCT projects share each name? A name
-- appearing 6 times is why grouping by it manufactures phantom duplicates.
SELECT name, count(*) AS projects_with_this_name
FROM public.projects GROUP BY name HAVING count(*) > 1 ORDER BY count(*) DESC;

-- =============================================================================
-- ONE-SHOT: every check above as a single pass/fail table
-- =============================================================================
-- The Supabase editor only displays the LAST statement's result, so running the file
-- top to bottom shows only the final query. This returns everything at once.
--
-- Each row states what was expected and what was found, so a failure names itself
-- rather than leaving a number to be interpreted.
WITH members AS (
  SELECT project_id, greatest(count(*), 1) AS seats
  FROM public.project_members GROUP BY project_id
),
ex AS (
  SELECT pw.project_id, pw.phase_number, pw.content_id, count(ua.id) AS done_by
  FROM public.project_pathways pw
  LEFT JOIN public.user_activities ua
         ON ua.content_id = pw.content_id AND ua.status = 'completed'
  GROUP BY pw.project_id, pw.phase_number, pw.content_id
),
per_phase AS (
  SELECT ph.project_id, ph.phase_number, (ph.lane_id IS NOT NULL) AS in_scope,
         CASE WHEN count(ex.content_id) = 0 THEN NULL
              ELSE 100.0 * sum(least(ex.done_by, m.seats)::numeric / m.seats)
                   / count(ex.content_id) END AS pct
  FROM public.project_phases ph
  LEFT JOIN members m ON m.project_id = ph.project_id
  LEFT JOIN ex ON ex.project_id = ph.project_id AND ex.phase_number = ph.phase_number
  GROUP BY ph.project_id, ph.phase_number, ph.lane_id
),
kestrel AS (
  SELECT p.id FROM public.projects p
  JOIN public.clients c ON c.id = p.client_id
  WHERE c.name LIKE '%Kestrel%' LIMIT 1
)
SELECT * FROM (
  VALUES
  ('1. Kestrel phases in scope', '2',
   (SELECT count(*)::text FROM per_phase WHERE project_id = (SELECT id FROM kestrel) AND in_scope)),

  ('2. Kestrel Diagnose %', '100',
   (SELECT coalesce(round(pct)::text,'NULL') FROM per_phase
    WHERE project_id = (SELECT id FROM kestrel) AND phase_number = 1)),

  ('2. Kestrel Design %', '20',
   (SELECT coalesce(round(pct)::text,'NULL') FROM per_phase
    WHERE project_id = (SELECT id FROM kestrel) AND phase_number = 2)),

  -- Out of scope AND unauthored. NULL is the right answer: nothing has been asked of
  -- anyone, so there is no percentage to report. A 0 here would be a claim of failure.
  ('2. Kestrel Engage % (deferred)', 'NULL',
   (SELECT coalesce(round(pct)::text,'NULL') FROM per_phase
    WHERE project_id = (SELECT id FROM kestrel) AND phase_number = 3)),

  ('3. Kestrel PROGRAMME %', '60',
   (SELECT coalesce(round(avg(pct))::text,'NULL') FROM per_phase
    WHERE project_id = (SELECT id FROM kestrel) AND in_scope AND pct IS NOT NULL)),

  -- If this were computed over all five phases instead, it would read 36. Shown so the
  -- wrong answer is visible next to the right one rather than having to be imagined.
  ('3. (wrong maths would give)', '36',
   (SELECT coalesce(round(sum(pct)/5)::text,'NULL') FROM per_phase
    WHERE project_id = (SELECT id FROM kestrel) AND pct IS NOT NULL)),

  ('4. Activities on deferred phases', '0',
   (SELECT count(*)::text FROM public.project_pathways pw
    JOIN public.project_phases ph ON ph.project_id = pw.project_id
                                 AND ph.phase_number = pw.phase_number
    WHERE ph.lane_id IS NULL)),

  ('5. Duplicate phase rows', '0',
   (SELECT count(*)::text FROM (
      SELECT project_id, phase_number FROM public.project_phases
      GROUP BY project_id, phase_number HAVING count(*) > 1) d)),

  ('6. Projects NOT fully scoped', 'only Kestrel',
   (SELECT coalesce(string_agg(DISTINCT p.name, ', '), 'none')
    FROM per_phase pp JOIN public.projects p ON p.id = pp.project_id
    WHERE NOT pp.in_scope))
) AS t(check_name, expected, actual);
