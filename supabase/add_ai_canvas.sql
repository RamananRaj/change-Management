-- ChangeFlow · AI Canvas — framework
-- One table: ai_usage — telemetry for the tiered router (Rules → local SLM → external).
-- One row per answered query. Powers the System Admin "AI Usage" tab.
-- Capability-specific tables (e.g. a stakeholder-impact heat map) get added as each
-- capability is built. Uses public.is_admin() and public.my_client_id(). Safe to re-run.

-- ── AI usage telemetry ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.ai_usage (
  id          uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at  timestamptz DEFAULT now(),
  user_id     uuid DEFAULT auth.uid(),        -- who asked
  client_id   uuid,                           -- their client (null for Master Admin / unassigned)
  tier        text CHECK (tier IN ('rules','slm','external')),
  intent      text,                           -- matched rule id, or 'freeform'
  query       text,                           -- truncated preview of the prompt (≤300 chars)
  ok          boolean DEFAULT true,
  escalated   boolean DEFAULT false,          -- true when it went past the Rules layer
  latency_ms  int,
  model       text,                           -- SLM/external model id, null for rules
  tokens      int
);

CREATE INDEX IF NOT EXISTS ai_usage_created_idx ON public.ai_usage (created_at DESC);
CREATE INDEX IF NOT EXISTS ai_usage_client_idx  ON public.ai_usage (client_id);

ALTER TABLE public.ai_usage ENABLE ROW LEVEL SECURITY;

-- Anyone signed in may log their own query.
DROP POLICY IF EXISTS "Users log own AI usage" ON public.ai_usage;
CREATE POLICY "Users log own AI usage" ON public.ai_usage
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());

-- Master Admin reads everything; Client Admin reads their own client's usage.
DROP POLICY IF EXISTS "Admins read AI usage" ON public.ai_usage;
CREATE POLICY "Admins read AI usage" ON public.ai_usage
  FOR SELECT USING (public.is_admin() OR (client_id IS NOT NULL AND client_id = public.my_client_id()));

GRANT SELECT, INSERT ON public.ai_usage TO authenticated;

SELECT 'ai_usage table created' AS result;
