-- ChangeFlow · DEMO READINESS — what each client can actually answer
-- =============================================================================
-- CORA sweeps every aspect on every answer, so a question asked against a client with
-- no gate, no comms plan and no training data returns a truthful answer followed by a
-- list of what is missing. That is the product working as designed — but in front of a
-- prospect it reads as a list of holes unless you chose to show it.
--
-- This inventories what each demo client holds, so questions can be picked to land on
-- data that exists rather than discovered live.
-- =============================================================================

SELECT
  c.name AS client,
  p.name AS project,
  count(DISTINCT ph.id) FILTER (WHERE ph.lane_id IS NOT NULL) AS phases_in_scope,
  count(DISTINCT m.user_id)                                   AS members,
  count(DISTINCT a.id)                                        AS audiences,
  count(DISTINCT a.id) FILTER (WHERE a.impact_rated_on IS NOT NULL) AS audiences_rated,
  count(DISTINCT pw.id)                                       AS pathway_items,
  count(DISTINCT ms.id)                                       AS milestones,
  count(DISTINCT tm.id)                                       AS training_modules,
  count(DISTINCT sn.id)                                       AS snapshots,
  -- The four artifacts the story and the aspect sweep look for.
  coalesce(string_agg(DISTINCT ar.type, ', '), '—')           AS artifacts
FROM public.clients c
JOIN public.projects p        ON p.client_id = c.id
LEFT JOIN public.project_phases ph   ON ph.project_id = p.id
LEFT JOIN public.project_members m   ON m.project_id  = p.id
LEFT JOIN public.audiences a         ON a.project_id  = p.id
LEFT JOIN public.project_pathways pw ON pw.project_id = p.id
LEFT JOIN public.project_milestones ms ON ms.project_id = p.id
LEFT JOIN public.training_modules tm ON tm.project_id = p.id
LEFT JOIN public.progress_snapshots sn ON sn.project_id = p.id
LEFT JOIN public.change_artifacts ar ON ar.client_id = c.id AND ar.is_current
GROUP BY c.name, p.name
ORDER BY c.name, p.name;

-- ─────────────────────────────────────────────────────────────
-- The headline number each client will show TODAY
-- ─────────────────────────────────────────────────────────────
-- Run this immediately before the demo. Adding a member changes it, and the figure in
-- any script written earlier goes stale silently.
WITH seats AS (
  SELECT project_id, greatest(count(DISTINCT user_id), 1) AS n
  FROM public.project_members GROUP BY project_id
),
ex AS (
  SELECT pw.project_id, pw.phase_number, pw.content_id,
         count(DISTINCT ua.user_id) AS done_by
  FROM public.project_pathways pw
  LEFT JOIN public.project_members pm ON pm.project_id = pw.project_id
  LEFT JOIN public.user_activities ua
         ON ua.content_id = pw.content_id AND ua.user_id = pm.user_id
        AND ua.status = 'completed'
  GROUP BY pw.project_id, pw.phase_number, pw.content_id
),
per_phase AS (
  SELECT ph.project_id, ph.phase_number,
         CASE WHEN count(ex.content_id) = 0 THEN NULL
              ELSE 100.0 * sum(least(ex.done_by, s.n)::numeric / s.n) / count(ex.content_id)
         END AS pct
  FROM public.project_phases ph
  LEFT JOIN seats s ON s.project_id = ph.project_id
  LEFT JOIN ex ON ex.project_id = ph.project_id AND ex.phase_number = ph.phase_number
  WHERE ph.lane_id IS NOT NULL
  GROUP BY ph.project_id, ph.phase_number
)
SELECT c.name AS client, p.name AS project,
       count(*)              AS phases_in_scope,
       round(avg(pp.pct))    AS programme_pct,
       string_agg(coalesce(round(pp.pct)::text, '—'), ' · ' ORDER BY pp.phase_number) AS per_phase
FROM per_phase pp
JOIN public.projects p ON p.id = pp.project_id
JOIN public.clients  c ON c.id = p.client_id
GROUP BY c.name, p.name
ORDER BY c.name;
