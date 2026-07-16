// ChangeFlow · ai-complete Edge Function (external model, tier 3)
//
// Reached ONLY when the browser's Rules layer and on-device SLM couldn't answer. Proxies to
// a hosted model, but ONLY if the org has set a provider key. With no key it returns
// { configured:false } and nothing leaves the environment — the app shows a graceful message.
//
// Enable:  supabase secrets set AI_PROVIDER=anthropic AI_PROVIDER_KEY=sk-...
//          supabase functions deploy ai-complete
//
// Requires a signed-in user (verifies the JWT). Keeps the key server-side; the browser never
// sees it. Deliberately minimal — no data is attached to the prompt here; grounded answers
// come from the Rules tier, this is for open-ended phrasing only.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } })

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  try {
    // Require a valid signed-in user.
    const url = Deno.env.get('SUPABASE_URL')!
    const anon = Deno.env.get('SUPABASE_ANON_KEY')!
    const authHeader = req.headers.get('Authorization') ?? ''
    const caller = createClient(url, anon, { global: { headers: { Authorization: authHeader } } })
    const { data: { user } } = await caller.auth.getUser()
    if (!user) return json({ error: 'unauthorized' }, 401)

    const { prompt } = await req.json().catch(() => ({ prompt: '' }))
    if (!prompt) return json({ error: 'no prompt' }, 400)

    const provider = Deno.env.get('AI_PROVIDER') ?? 'anthropic'
    const key = Deno.env.get('AI_PROVIDER_KEY') ?? ''
    if (!key) return json({ configured: false })   // nothing leaves the environment

    const system = "You are ChangeFlow's assistant for change management. Be concise and practical. Never invent specific figures, dates, or names — say you can only speak generally."

    if (provider === 'anthropic') {
      const r = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
        body: JSON.stringify({ model: Deno.env.get('AI_MODEL') ?? 'claude-haiku-4-5-20251001', max_tokens: 500, system, messages: [{ role: 'user', content: prompt }] }),
      })
      const d = await r.json()
      if (!r.ok) return json({ error: d?.error?.message ?? 'provider error' }, 502)
      return json({ text: d?.content?.[0]?.text ?? '', model: d?.model ?? 'anthropic', configured: true })
    }

    // OpenAI-compatible fallback
    const r = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      body: JSON.stringify({ model: Deno.env.get('AI_MODEL') ?? 'gpt-4o-mini', max_tokens: 500, messages: [{ role: 'system', content: system }, { role: 'user', content: prompt }] }),
    })
    const d = await r.json()
    if (!r.ok) return json({ error: d?.error?.message ?? 'provider error' }, 502)
    return json({ text: d?.choices?.[0]?.message?.content ?? '', model: d?.model ?? 'openai', configured: true })
  } catch (e) {
    return json({ error: String(e) }, 500)
  }
})
