// ChangeFlow · external model fallback (tier 3, last resort)
//
// Only reached when neither the Rules layer nor the local SLM could answer. Calls the
// `ai-complete` Edge Function, which proxies to a hosted model IF the org has configured a
// provider key (secret AI_PROVIDER_KEY). Until then it returns configured:false and the UI
// shows a "not configured" message rather than sending anything off-device.
//
// This is the ONLY tier where the prompt can leave the user's environment, so the router
// marks these rows escalated=true and the UI flags them.

import { supabase } from '../supabase'

const SYSTEM = "You are CORA, ChangeFlow's change-management assistant. Speak naturally, like a helpful colleague. Answer using ONLY the grounded client context below; if a detail isn't there, say you don't have it yet — never invent data."

export async function runExternal(text, ctx = {}) {
  try {
    // Build one grounded, conversational prompt: system + client context + recent turns + question.
    const parts = [SYSTEM]
    if (ctx.grounding) parts.push(`\nGrounded client context:\n${ctx.grounding}`)
    if (ctx.history?.length) parts.push('\nConversation so far:\n' + ctx.history.map(h => `User: ${h.q}\nCORA: ${h.a}`).join('\n'))
    parts.push(`\nUser: ${text}\nCORA:`)
    const prompt = parts.join('\n')
    const { data, error } = await supabase.functions.invoke('ai-complete', { body: { prompt } })
    if (error) return { text: 'The external model is unavailable right now.', model: null, configured: false, error: true }
    if (data?.configured === false) {
      return { text: "I couldn't answer that from your data, and no external model is configured for your organisation. Try rephrasing as a data question (progress, at-risk, milestones, readiness, stakeholder heat map).", model: null, configured: false }
    }
    return { text: data?.text ?? '', model: data?.model ?? 'external', configured: true }
  } catch {
    return { text: 'The external model is unavailable right now.', model: null, configured: false, error: true }
  }
}
