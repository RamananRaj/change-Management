-- ChangeFlow · scalable AI-usage aggregates for the System Admin "AI Usage" tab.
-- As the customer base grows, grouping the last-N rows client-side stops being accurate. This
-- function aggregates the WHOLE dataset in Postgres and returns one row per client and per project,
-- with a per-tier breakdown, so the UI can search and rank clients at any scale.
--
-- Scoping: SECURITY DEFINER (so it can aggregate), but the WHERE clause enforces the same rule as
-- the ai_usage SELECT policy — Master Admin sees everything; a Client Admin sees only their client.
-- p_since limits to a time window (NULL = all time). Safe to re-run.

CREATE OR REPLACE FUNCTION public.ai_usage_by_tenant(p_since timestamptz DEFAULT NULL)
RETURNS TABLE (
  scope       text,
  id          uuid,
  name        text,
  queries     bigint,
  rules       bigint,
  slm         bigint,
  external    bigint,
  avg_latency int,
  last_at     timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  -- One row per client (includes the NULL "Unattributed" bucket for Master Admin).
  SELECT 'client'::text, u.client_id, c.name,
         count(*),
         count(*) FILTER (WHERE u.tier = 'rules'),
         count(*) FILTER (WHERE u.tier = 'slm'),
         count(*) FILTER (WHERE u.tier = 'external'),
         round(avg(u.latency_ms))::int,
         max(u.created_at)
  FROM public.ai_usage u
  LEFT JOIN public.clients c ON c.id = u.client_id
  WHERE (p_since IS NULL OR u.created_at >= p_since)
    AND (public.is_admin() OR u.client_id = public.my_client_id())
  GROUP BY u.client_id, c.name

  UNION ALL

  -- One row per attributed project.
  SELECT 'project'::text, u.project_id, p.name,
         count(*),
         count(*) FILTER (WHERE u.tier = 'rules'),
         count(*) FILTER (WHERE u.tier = 'slm'),
         count(*) FILTER (WHERE u.tier = 'external'),
         round(avg(u.latency_ms))::int,
         max(u.created_at)
  FROM public.ai_usage u
  JOIN public.projects p ON p.id = u.project_id
  WHERE (p_since IS NULL OR u.created_at >= p_since)
    AND (public.is_admin() OR p.client_id = public.my_client_id())
  GROUP BY u.project_id, p.name;
$$;

GRANT EXECUTE ON FUNCTION public.ai_usage_by_tenant(timestamptz) TO authenticated;

SELECT 'ai_usage_by_tenant() created' AS result;
