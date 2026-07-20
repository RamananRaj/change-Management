// ChangeFlow · AI router
//
// The escalation ladder the user asked for:  Rules → local SLM → external model.
// Rules answer grounded, factual questions for free and privately. Only when no rule matches
// does it fall to the in-browser SLM, and only when that's unavailable/failing does it reach
// the external model (the one path where data can leave the device). Every hop is logged to
// ai_usage — attributed to the client/project it was about — so the System Admin tab can show
// exactly where the work is landing.

import { supabase } from '../supabase'
import { runRules, assembleClientContext } from './rules'
import { groundedFallback, resolveUsageScope } from './analysis'
import { slmAvailable, runSlm } from './slm'
import { runExternal } from './external'
import { logUsage } from './telemetry'

// Small cached id/name index (clients + projects) used only to attribute usage to a tenant.
// Loaded once per session; RLS scopes it to what the caller may see.
let scopeIndexPromise = null
function usageIndex() {
  if (!scopeIndexPromise) {
    scopeIndexPromise = (async () => {
      const [{ data: cl }, { data: pr }] = await Promise.all([
        supabase.from('clients').select('id, name'),
        supabase.from('projects').select('id, name, client_id'),
      ])
      return { clients: cl ?? [], projects: pr ?? [] }
    })().catch(() => ({ clients: [], projects: [] }))
  }
  return scopeIndexPromise
}

// Log off the critical path: resolve the client/project the query was about, then write the row.
// descriptor-provided ids (e.g. a report's client_id/project_id) take precedence over inference.
function logScoped(base, text, ctx, descriptor) {
  usageIndex().then(idx => {
    const scope = resolveUsageScope(text, ctx.entity, idx.clients, idx.projects)
    logUsage({
      ...base, ctx,
      clientId: descriptor?.client_id ?? scope.clientId ?? ctx.clientId ?? null,
      projectId: descriptor?.project_id ?? scope.projectId ?? null,
    })
  }).catch(() => { /* telemetry is best-effort */ })
}

// ask(text, ctx, { onProgress }) → widget descriptor annotated with the tier that answered.
// ctx = { userId, clientId, entity, history }. onProgress is forwarded to the SLM for downloads.
export async function ask(text, ctx = {}, { onProgress } = {}) {
  const t0 = performance.now()

  // 1 ── Rules (grounded, $0, private)
  const r = await runRules(text, ctx)
  if (r.matched) {
    const latency = performance.now() - t0
    logScoped({ tier: 'rules', intent: r.intent, query: text, ok: true, escalated: false, latency_ms: latency }, text, ctx, r.descriptor)
    return { tier: 'rules', intent: r.intent, ...r.descriptor }
  }

  // Freeform question — assemble the grounded client context so the conversational tiers can
  // answer about anything in the client's picture (projects, phases, progress, risks, readiness).
  let grounding = ''
  try { grounding = await assembleClientContext(ctx.entity) } catch { /* best effort */ }
  const gctx = { ...ctx, grounding }

  // 2 ── Local SLM (on-device, $0, private) — only if opted in + WebGPU present
  if (await slmAvailable()) {
    try {
      const out = await runSlm(text, gctx, onProgress)
      const latency = performance.now() - t0
      logScoped({ tier: 'slm', intent: 'freeform', query: text, ok: true, escalated: true, latency_ms: latency, model: out.model, tokens: out.tokens }, text, ctx)
      return { tier: 'slm', type: 'narrative', title: 'CORA', body: out.text }
    } catch {
      // fall through to external
    }
  }

  // 3 ── External model (last resort; may leave the device)
  const ext = await runExternal(text, gctx)
  const latency = performance.now() - t0

  // No usable external answer — whether because none is configured OR because the
  // call failed. Both mean the same thing to the user, so both get the grounded
  // fallback. Gating this on !ext.error was wrong: a failed call is the single most
  // likely reason to need a fallback, and it was the one case that skipped it.
  if (ext.configured === false || ext.error) {
    const body = groundedFallback(text, grounding)
    if (body) {
      logScoped({ tier: 'rules', intent: 'grounded_fallback', query: text, ok: true, escalated: false, latency_ms: latency }, text, ctx)
      return { tier: 'rules', type: 'narrative', title: 'CORA', body, grounded: true }
    }
  }

  logScoped({ tier: 'external', intent: 'freeform', query: text, ok: !ext.error, escalated: true, latency_ms: latency, model: ext.model }, text, ctx)
  return { tier: 'external', type: 'narrative', title: 'CORA', body: ext.text, external: ext.configured !== false }
}
