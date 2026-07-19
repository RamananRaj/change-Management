// ChangeFlow · in-browser SLM provider (tier 2)
//
// The "local SLM" runs entirely on the user's own device via WebLLM + WebGPU — $0 server
// cost, and the prompt never leaves the browser. It's used only when the Rules layer can't
// answer, and only for phrasing/general Q&A: the system prompt forbids inventing figures,
// because grounded numbers always come from the Rules tier.
//
// Deliberately opt-in: the model is a few hundred MB to download, so we don't auto-fetch it
// for every visitor. Enable per-device with:  localStorage.setItem('cf_ai_slm','on')
// Then it lazy-loads on first freeform question. Swap MODEL for a larger one if desired.
//
// This provider is behind a stable interface (slmAvailable / runSlm) so it can later be
// replaced by a self-hosted Ollama endpoint without touching the router or the UI.

const MODEL = 'Qwen2.5-1.5B-Instruct-q4f16_1-MLC'
let enginePromise = null

export function slmOptedIn() {
  try { return localStorage.getItem('cf_ai_slm') === 'on' } catch { return false }
}

// Available only when opted in AND the browser exposes WebGPU.
export async function slmAvailable() {
  return slmOptedIn() && typeof navigator !== 'undefined' && 'gpu' in navigator
}

// Lazy-load the engine once. onProgress({ text, progress }) reports the download.
async function getEngine(onProgress) {
  if (!enginePromise) {
    enginePromise = (async () => {
      // CDN import keeps WebLLM out of the bundle and off npm — no build change needed.
      const webllm = await import(/* @vite-ignore */ 'https://esm.run/@mlc-ai/web-llm')
      return webllm.CreateMLCEngine(MODEL, { initProgressCallback: onProgress })
    })().catch(err => { enginePromise = null; throw err })
  }
  return enginePromise
}

const SYSTEM = [
  "You are CORA, ChangeFlow's change-management assistant. Speak naturally and conversationally, like a helpful colleague.",
  'Answer using ONLY the grounded client context provided to you (projects, phases, progress, risks, milestones, readiness, stakeholder impact).',
  "If a detail isn't in that context, say you don't have it yet rather than inventing anything. Keep replies concise and practical.",
].join(' ')

export async function runSlm(text, ctx = {}, onProgress) {
  const engine = await getEngine(onProgress)
  const messages = [{ role: 'system', content: SYSTEM }]
  if (ctx.grounding) messages.push({ role: 'system', content: `Grounded client context (answer only from this):\n${ctx.grounding}` })
  ;(ctx.history ?? []).forEach(h => { if (h.q) messages.push({ role: 'user', content: h.q }); if (h.a) messages.push({ role: 'assistant', content: h.a }) })
  messages.push({ role: 'user', content: text })
  const res = await engine.chat.completions.create({ messages, temperature: 0.4, max_tokens: 500 })
  const out = res?.choices?.[0]?.message?.content ?? ''
  const tokens = res?.usage?.total_tokens ?? null
  return { text: out, model: MODEL, tokens }
}

// Generic generation with a caller-supplied system prompt (e.g. report-style rewriting).
export async function slmGenerate(system, user, onProgress, { temperature = 0.5, maxTokens = 320 } = {}) {
  const engine = await getEngine(onProgress)
  const res = await engine.chat.completions.create({
    messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
    temperature, max_tokens: maxTokens,
  })
  return res?.choices?.[0]?.message?.content ?? ''
}
