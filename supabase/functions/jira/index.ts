// ChangeFlow — jira Edge Function
//
// The ONLY place a client's Jira API token is ever read. The token lives in
// public.client_integrations (admin-only RLS) and is read here with the service
// role; it is never returned to any caller and never reaches the browser.
//
// Two actions, both POST { action, client_id }:
//   • "test"  — verify the connection (GET /myself). Records the result on the row.
//   • "fetch" — run the client's JQL and return a normalised list of issues, so the
//               UI can preview them and CORA can reason over them.
//
// Every call is authorised against the CALLER: they must be a signed-in Master Admin
// (profiles.is_admin). A client admin or member cannot reach another tenant's Jira,
// and an anonymous caller cannot reach it at all.
//
// Deploy:  supabase functions deploy jira
//   (SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY injected automatically)

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } })

// Pull the fields the change team actually cares about out of a raw Jira issue.
// Everything is optional — different Jira configs populate different fields, so we
// read defensively and never assume a custom field exists.
function normalise(issue: any, baseUrl: string) {
  const f = issue?.fields ?? {}
  return {
    key: issue?.key ?? null,
    summary: f.summary ?? '(no summary)',
    status: f.status?.name ?? null,
    statusCategory: f.status?.statusCategory?.key ?? null,   // to-do / in-progress / done
    type: f.issuetype?.name ?? null,
    priority: f.priority?.name ?? null,                       // the closest thing to severity
    assignee: f.assignee?.displayName ?? null,
    updated: f.updated ?? null,
    created: f.created ?? null,
    labels: Array.isArray(f.labels) ? f.labels : [],
    url: issue?.key ? `${baseUrl.replace(/\/$/, '')}/browse/${issue.key}` : null,
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  try {
    const url        = Deno.env.get('SUPABASE_URL')!
    const anonKey    = Deno.env.get('SUPABASE_ANON_KEY')!
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || Deno.env.get('SB_SERVICE_ROLE_KEY') || ''
    const authHeader = req.headers.get('Authorization') ?? ''

    // ── Who is calling? Must be a Master Admin. ──────────────────────────────
    const caller = createClient(url, anonKey, { global: { headers: { Authorization: authHeader } } })
    const { data: { user: me } } = await caller.auth.getUser()
    if (!me) return json({ error: 'unauthorized' }, 401)
    const { data: prof } = await caller.from('profiles').select('is_admin').eq('id', me.id).single()
    if (!prof?.is_admin) return json({ error: 'forbidden' }, 403)

    const { action, client_id } = await req.json().catch(() => ({}))
    if (!client_id || !['test', 'fetch'].includes(action))
      return json({ error: 'bad request' }, 400)

    // ── Read the connection with the SERVICE role (this is the only token read) ─
    if (!serviceKey) return json({ error: 'not configured' }, 503)
    const admin = createClient(url, serviceKey)
    const { data: cfg } = await admin
      .from('client_integrations')
      .select('base_url, auth_email, api_token, jql, enabled')
      .eq('client_id', client_id).eq('provider', 'jira').single()

    if (!cfg) return json({ error: 'no integration configured for this client' }, 404)
    if (!cfg.base_url || !cfg.auth_email || !cfg.api_token)
      return json({ error: 'connection incomplete — base URL, email and token are all required' }, 400)

    const base = cfg.base_url.replace(/\/$/, '')
    const authz = 'Basic ' + btoa(`${cfg.auth_email}:${cfg.api_token}`)
    const headers = { Authorization: authz, Accept: 'application/json', 'Content-Type': 'application/json' }

    // ── TEST ────────────────────────────────────────────────────────────────
    if (action === 'test') {
      let ok = false, note = ''
      try {
        const r = await fetch(`${base}/rest/api/3/myself`, { headers })
        ok = r.ok
        note = r.ok
          ? `Connected as ${(await r.json())?.displayName ?? cfg.auth_email}.`
          : `Jira returned ${r.status}. Check the URL, email and token.`
      } catch (e) {
        note = 'Could not reach Jira — check the base URL.'
      }
      // Record the result on the row so the UI shows status without re-testing.
      await admin.from('client_integrations')
        .update({ last_tested_at: new Date().toISOString(), last_test_ok: ok, last_test_note: note.slice(0, 400) })
        .eq('client_id', client_id).eq('provider', 'jira')
      return json({ ok, note })
    }

    // ── FETCH ─────────────────────────────────────────────────────────────────
    // Uses the current /search/jql endpoint. maxResults capped so a broad query
    // can't pull thousands of issues into a preview.
    if (action === 'fetch') {
      if (!cfg.enabled) return json({ error: 'integration is turned off' }, 409)
      const body = {
        jql: cfg.jql,
        maxResults: 50,
        fields: ['summary', 'status', 'issuetype', 'priority', 'assignee', 'updated', 'created', 'labels'],
      }
      const r = await fetch(`${base}/rest/api/3/search/jql`, { method: 'POST', headers, body: JSON.stringify(body) })
      if (!r.ok) {
        // Surface Jira's own message (often "the JQL is invalid") without leaking anything sensitive.
        const detail = await r.text().catch(() => '')
        return json({ error: `Jira search failed (${r.status})`, detail: detail.slice(0, 300) }, 502)
      }
      const data = await r.json()
      const issues = (data?.issues ?? []).map((i: any) => normalise(i, base))

      // A small summary the UI and CORA can use directly.
      const byStatus: Record<string, number> = {}
      const byPriority: Record<string, number> = {}
      let open = 0
      for (const it of issues) {
        if (it.status) byStatus[it.status] = (byStatus[it.status] ?? 0) + 1
        if (it.priority) byPriority[it.priority] = (byPriority[it.priority] ?? 0) + 1
        if (it.statusCategory && it.statusCategory !== 'done') open++
      }
      return json({
        ok: true,
        jql: cfg.jql,
        total: issues.length,
        open,
        byStatus,
        byPriority,
        issues,
      })
    }

    return json({ error: 'bad request' }, 400)
  } catch (e) {
    console.error('jira function failed:', e)
    return json({ error: 'unavailable' }, 500)
  }
})
