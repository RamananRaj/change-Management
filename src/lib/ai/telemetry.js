// ChangeFlow · AI usage telemetry
// Best-effort logging of every answered query to public.ai_usage. Never throws — a failed
// log must never break the answer. Powers the System Admin "AI Usage" tab.

import { supabase } from '../supabase'

export async function logUsage({ tier, intent, query, ok = true, escalated = false, latency_ms, model = null, tokens = null, ctx = {} }) {
  try {
    await supabase.from('ai_usage').insert({
      user_id: ctx.userId ?? null,
      client_id: ctx.clientId ?? null,
      tier, intent,
      query: (query ?? '').slice(0, 300),
      ok, escalated,
      latency_ms: latency_ms != null ? Math.round(latency_ms) : null,
      model, tokens,
    })
  } catch { /* telemetry is best-effort */ }
}
