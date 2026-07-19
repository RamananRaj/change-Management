// ChangeFlow · AI usage telemetry
// Best-effort logging of every answered query to public.ai_usage. Never throws — a failed
// log must never break the answer. Powers the System Admin "AI Usage" tab.

import { supabase } from '../supabase'

export async function logUsage({ tier, intent, query, ok = true, escalated = false, latency_ms, model = null, tokens = null, ctx = {}, clientId, projectId }) {
  try {
    await supabase.from('ai_usage').insert({
      user_id: ctx.userId ?? null,
      // Attributed client/project (from the resolved scope) win; fall back to the caller's own client.
      client_id: clientId ?? ctx.clientId ?? null,
      project_id: projectId ?? null,
      tier, intent,
      query: (query ?? '').slice(0, 300),
      ok, escalated,
      latency_ms: latency_ms != null ? Math.round(latency_ms) : null,
      model, tokens,
    })
  } catch { /* telemetry is best-effort */ }
}
