// ChangeFlow — health-check Edge Function
//
// Runs server-side system checks and records a row in public.health_runs. Called two ways:
//   • Scheduled (pg_cron)   → sends header x-cron-secret === HEALTH_CRON_SECRET.
//   • Manual (from the app) → sends an admin's JWT; we verify profiles.is_admin.
//
// Deploy:  supabase secrets set HEALTH_CRON_SECRET=<random>
//          supabase functions deploy health-check --no-verify-jwt

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
    const url        = Deno.env.get('SUPABASE_URL')!
    const anonKey    = Deno.env.get('SUPABASE_ANON_KEY')!
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || Deno.env.get('SB_SERVICE_ROLE_KEY') || ''
    const cronSecret = Deno.env.get('HEALTH_CRON_SECRET') ?? ''
    const admin = createClient(url, serviceKey)

    const body = await req.json().catch(() => ({}))
    let source: string = body.source === 'manual' ? 'manual' : 'scheduled'

    // ── Authorize ──
    let authorized = false
    const providedSecret = req.headers.get('x-cron-secret')
    if (cronSecret && providedSecret && providedSecret === cronSecret) {
      authorized = true; source = 'scheduled'
    } else {
      const authHeader = req.headers.get('Authorization') ?? ''
      const caller = createClient(url, anonKey, { global: { headers: { Authorization: authHeader } } })
      const { data: { user } } = await caller.auth.getUser()
      if (user) {
        const { data: p } = await caller.from('profiles').select('is_admin').eq('id', user.id).single()
        if (p?.is_admin) { authorized = true; source = 'manual' }
      }
    }
    if (!authorized) return json({ error: 'unauthorized' }, 401)

    // ── Run checks (service role) ──
    const t0 = Date.now()
    const checks: { name: string; group: string; ok: boolean; detail: string }[] = []
    const check = async (name: string, group: string, fn: () => Promise<string>) => {
      const s = Date.now()
      try { checks.push({ name, group, ok: true, detail: await fn() }) }
      catch (e) { checks.push({ name, group, ok: false, detail: String((e as Error)?.message ?? e).slice(0, 120) }) }
      return Date.now() - s
    }
    const head = (table: string) => async () => {
      const { count, error } = await admin.from(table).select('id', { count: 'exact', head: true })
      if (error) throw error
      return `${count ?? 0} rows`
    }

    const p0 = Date.now()
    const { error: pingErr } = await admin.from('clients').select('id', { count: 'exact', head: true })
    await check('Database (Supabase)', 'Server', async () => { if (pingErr) throw pingErr; return `${Date.now() - p0}ms response` })

    for (const t of ['clients', 'projects', 'project_phases', 'project_pathways', 'project_milestones', 'project_members', 'phase_content', 'surveys', 'stakeholders', 'industries', 'roles', 'user_activities', 'project_invites', 'health_runs'])
      await check(t, 'Data', head(t))

    const total = checks.length
    const passed = checks.filter(c => c.ok).length
    const failed = total - passed
    const duration_ms = Date.now() - t0

    const { error: insErr } = await admin.from('health_runs').insert({ source, total, passed, failed, checks, duration_ms })
    if (insErr) return json({ error: insErr.message }, 500)

    return json({ ok: true, source, total, passed, failed, duration_ms })
  } catch (e) {
    return json({ error: String(e) }, 500)
  }
})
