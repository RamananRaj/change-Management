// ChangeFlow — e2e-trigger Edge Function
//
// Starts a Playwright E2E run without touching a terminal. Playwright needs a real browser, so the
// run happens in GitHub Actions: this function calls the workflow_dispatch API, the workflow runs
// the suite, and the reporter posts results back to e2e_runs (System Admin → E2E Tests).
//
// Two callers:
//   • Master Admin  → "Run tests now" button (admin JWT verified against profiles.is_admin)
//   • pg_cron       → scheduled runs (x-cron-secret === E2E_TRIGGER_SECRET)
//
// Deploy:  supabase functions deploy e2e-trigger --no-verify-jwt
// Secrets: E2E_TRIGGER_SECRET, GITHUB_TOKEN (PAT with actions:write), GITHUB_REPO (owner/repo)

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } })

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  try {
    const url = Deno.env.get('SUPABASE_URL')!
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!
    const cronSecret = Deno.env.get('E2E_TRIGGER_SECRET') ?? ''
    const ghToken = Deno.env.get('GITHUB_TOKEN') ?? ''
    const ghRepo = Deno.env.get('GITHUB_REPO') ?? ''          // e.g. RamananRaj/change-Management
    const workflow = Deno.env.get('E2E_WORKFLOW') ?? 'e2e.yml'
    const ref = Deno.env.get('E2E_REF') ?? 'main'

    // ── Authorize: cron secret, else an admin's session ──
    let source = 'scheduled'
    let authorized = false
    if (cronSecret && req.headers.get('x-cron-secret') === cronSecret) {
      authorized = true
    } else {
      const caller = createClient(url, anonKey, { global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } } })
      const { data: { user } } = await caller.auth.getUser()
      if (user) {
        const { data: p } = await caller.from('profiles').select('is_admin').eq('id', user.id).single()
        if (p?.is_admin) { authorized = true; source = 'manual' }
      }
    }
    if (!authorized) return json({ error: 'unauthorized' }, 401)

    if (!ghToken || !ghRepo) return json({ error: 'GitHub not configured — set GITHUB_TOKEN and GITHUB_REPO secrets' }, 400)

    // ── Fire the workflow ──
    const r = await fetch(`https://api.github.com/repos/${ghRepo}/actions/workflows/${workflow}/dispatches`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${ghToken}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'Content-Type': 'application/json',
        'User-Agent': 'changeflow-e2e-trigger',
      },
      body: JSON.stringify({ ref }),
    })
    if (r.status !== 204) {
      const body = await r.text().catch(() => '')
      return json({ error: `GitHub dispatch failed (${r.status})`, detail: body.slice(0, 300) }, 502)
    }
    return json({ ok: true, source, workflow, ref })
  } catch (e) {
    return json({ error: String(e) }, 500)
  }
})
