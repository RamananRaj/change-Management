// ChangeFlow — e2e-report Edge Function
//
// Receives a Playwright run summary (from the custom reporter, usually in CI) and records it in
// public.e2e_runs so System Admin → E2E Tests can show the history. Authorized by a shared secret.
//
// Deploy:  supabase functions deploy e2e-report --no-verify-jwt
// Secret:  E2E_REPORT_SECRET

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-report-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } })

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  try {
    const secret = Deno.env.get('E2E_REPORT_SECRET') ?? ''
    if (!secret || req.headers.get('x-report-secret') !== secret) return json({ error: 'unauthorized' }, 401)

    const url = Deno.env.get('SUPABASE_URL')!
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || Deno.env.get('SB_SERVICE_ROLE_KEY') || ''
    const admin = createClient(url, serviceKey)

    const b = await req.json().catch(() => ({}))
    const row = {
      source: b.source === 'local' ? 'local' : 'ci',
      total: b.total ?? null, passed: b.passed ?? null, failed: b.failed ?? null, skipped: b.skipped ?? null,
      duration_ms: b.duration_ms ?? null,
      specs: Array.isArray(b.specs) ? b.specs.slice(0, 200) : [],
      commit: (b.commit ?? '').slice(0, 60) || null,
      branch: (b.branch ?? '').slice(0, 120) || null,
    }
    const { error } = await admin.from('e2e_runs').insert(row)
    if (error) return json({ error: error.message }, 500)
    return json({ ok: true, ...row, specs: undefined })
  } catch (e) {
    return json({ error: String(e) }, 500)
  }
})
