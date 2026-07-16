// ChangeFlow · AI router
//
// The escalation ladder the user asked for:  Rules → local SLM → external model.
// Rules answer grounded, factual questions for free and privately. Only when no rule matches
// does it fall to the in-browser SLM, and only when that's unavailable/failing does it reach
// the external model (the one path where data can leave the device). Every hop is logged to
// ai_usage so the System Admin tab can show exactly where the work is landing.

import { runRules } from './rules'
import { slmAvailable, runSlm } from './slm'
import { runExternal } from './external'
import { logUsage } from './telemetry'

// ask(text, ctx, { onProgress }) → widget descriptor annotated with the tier that answered.
// ctx = { userId, clientId }. onProgress is forwarded to the SLM for model-download updates.
export async function ask(text, ctx = {}, { onProgress } = {}) {
  const t0 = performance.now()

  // 1 ── Rules (grounded, $0, private)
  const r = await runRules(text)
  if (r.matched) {
    const latency = performance.now() - t0
    logUsage({ tier: 'rules', intent: r.intent, query: text, ok: true, escalated: false, latency_ms: latency, ctx })
    return { tier: 'rules', ...r.descriptor }
  }

  // 2 ── Local SLM (on-device, $0, private) — only if opted in + WebGPU present
  if (await slmAvailable()) {
    try {
      const out = await runSlm(text, ctx, onProgress)
      const latency = performance.now() - t0
      logUsage({ tier: 'slm', intent: 'freeform', query: text, ok: true, escalated: true, latency_ms: latency, model: out.model, tokens: out.tokens, ctx })
      return { tier: 'slm', type: 'narrative', title: 'AI response', body: out.text }
    } catch {
      // fall through to external
    }
  }

  // 3 ── External model (last resort; may leave the device)
  const ext = await runExternal(text, ctx)
  const latency = performance.now() - t0
  logUsage({ tier: 'external', intent: 'freeform', query: text, ok: !ext.error, escalated: true, latency_ms: latency, model: ext.model, ctx })
  return { tier: 'external', type: 'narrative', title: 'AI response', body: ext.text, external: ext.configured !== false }
}
