import { Fragment, useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { slmOptedIn, setSlmOptedIn, webgpuSupported } from '../lib/ai/slm'

// Master Admin oversight hub. Its own sub-navigation keeps future views (users, invites,
// activity, health…) contained here rather than adding tabs to the top Admin bar.
// clientId set → scoped mode for a Client Admin (their client's users only).
export default function SystemAdmin({ allRoles = [], clientId = null }) {
  const scoped = !!clientId
  const subtabs = scoped
    ? ['User Management', 'Pending Invites', 'AI Usage']
    : ['User Management', 'Pending Invites', 'System Health', 'E2E Tests', 'AI Usage', 'Notifications']
  const [tab, setTab]         = useState('User Management')
  const [loading, setLoading] = useState(true)
  const [clients, setClients] = useState([])
  const [projects, setProjects] = useState([])
  const [users,   setUsers]   = useState([])
  const [invites, setInvites] = useState([])
  const [slmOn,   setSlmOn]   = useState(slmOptedIn())
  const [clientFilter, setClientFilter] = useState('')
  const [search, setSearch]   = useState('')
  const [editing, setEditing] = useState(null)   // user being edited
  const [editForm, setEditForm] = useState({ full_name: '', role: '', email: '' })
  const [busy, setBusy]       = useState(false)
  const [note, setNote]       = useState(null)   // { type:'ok'|'err', text }

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    const [{ data: cls }, { data: profs }, { data: pm }, { data: projs }, metaRes, { data: inv }] = await Promise.all([
      supabase.from('clients').select('id, name'),
      supabase.from('profiles').select('id, full_name, role, industry, is_admin, is_client_admin, client_id, onboarding_done, created_at'),
      supabase.from('project_members').select('user_id, project_id'),
      supabase.from('projects').select('id, name, client_id'),
      supabase.rpc('admin_user_meta'),
      supabase.from('project_invites').select('id, email, full_name, role, status, client_id, project_id, as_client_admin, created_at').eq('status', 'pending').order('created_at', { ascending: false }),
    ])
    setClients(cls ?? [])
    setProjects(projs ?? [])
    const metaOf   = id => (metaRes?.data ?? []).find(e => e.id === id)
    const projName = id => (projs ?? []).find(p => p.id === id)?.name

    setUsers((profs ?? [])
      .filter(p => !scoped || p.client_id === clientId)   // scoped mode: this client only
      .map(p => {
        const projNames = [...new Set((pm ?? []).filter(m => m.user_id === p.id).map(m => projName(m.project_id)).filter(Boolean))]
        const access = p.is_admin ? 'Master Admin' : p.is_client_admin ? 'Client Admin' : 'Member'
        const meta = metaOf(p.id)
        const locked = meta?.banned_until && new Date(meta.banned_until) > new Date()
        return { id: p.id, name: p.full_name ?? '—', email: meta?.email ?? null, role: p.role ?? null,
                 client_id: p.client_id ?? null, access, is_admin: !!p.is_admin, projects: projNames,
                 joined: p.created_at ?? null, lastSignIn: meta?.last_sign_in_at ?? null, locked }
      }).sort((a, b) => (a.name ?? '').localeCompare(b.name ?? '')))

    setInvites((inv ?? []).filter(i => !scoped || i.client_id === clientId).map(i => ({ ...i, projectName: projName(i.project_id) })))
    setLoading(false)
  }

  async function runAction(payload, confirmMsg) {
    if (confirmMsg && !window.confirm(confirmMsg)) return
    setBusy(true); setNote(null)
    const { data, error } = await supabase.functions.invoke('admin-user-actions', { body: payload })
    setBusy(false)
    if (error || data?.error) { setNote({ type: 'err', text: (data?.error ?? error?.message ?? 'Action failed') }); return false }
    setNote({ type: 'ok', text: 'Done.' })
    await load()
    return true
  }

  function openEdit(u) {
    setEditForm({ full_name: u.name === '—' ? '' : u.name, role: u.role ?? '', email: u.email ?? '' })
    setEditing(u); setNote(null)
  }
  async function saveEdit() {
    // Only send email when it actually changed — avoids an unnecessary (and error-prone)
    // auth-admin email update on a persona/name-only edit.
    const emailChanged = editForm.email && editForm.email.trim() !== (editing.email ?? '')
    const ok = await runAction({ action: 'update', userId: editing.id, full_name: editForm.full_name, role: editForm.role || null, email: emailChanged ? editForm.email.trim() : undefined })
    if (ok) setEditing(null)
  }
  const doReset  = u => runAction({ action: 'reset', userId: u.id, email: u.email, redirectTo: `${window.location.origin}/auth/reset` }, `Send a password reset link to ${u.email}?`)
  const doLock   = u => runAction({ action: u.locked ? 'unlock' : 'lock', userId: u.id }, `${u.locked ? 'Unlock' : 'Lock'} ${u.name}?`)
  const doDelete = u => runAction({ action: 'delete', userId: u.id }, `Permanently delete ${u.name}? This removes their account and cannot be undone.`)

  // ── System Health ──────────────────────────────────────────────────────────
  const [health, setHealth] = useState({ ran: false, running: false, checks: [], dbPing: null, at: null })
  const [healthHistory, setHealthHistory] = useState([])
  const [expandedRun, setExpandedRun] = useState(null)   // health_runs.id expanded to show per-check detail
  const [hsched, setHsched] = useState(null)             // { active, interval_minutes, cron } | null
  const [hschedBusy, setHschedBusy] = useState(false)
  const HEALTH_INTERVALS = [[0, 'Off'], [5, '5 min'], [15, '15 min'], [30, '30 min'], [60, 'Hourly']]

  async function loadHealthHistory() {
    const { data } = await supabase.from('health_runs').select('*').order('ran_at', { ascending: false }).limit(20)
    setHealthHistory(data ?? [])
  }
  async function loadSchedule() {
    const { data, error } = await supabase.rpc('get_health_schedule')
    setHsched(error ? null : (data?.[0] ?? { active: false, interval_minutes: null, cron: null }))
  }
  async function saveSchedule(minutes) {
    setHschedBusy(true); setNote(null)
    const { data, error } = await supabase.rpc('set_health_schedule', { p_minutes: minutes })
    setHschedBusy(false)
    if (error) { setNote({ type: 'err', text: error.message.includes('health_cron_config') ? 'Schedule store not set up yet — run add_health_schedule.sql and insert the URL + secret.' : error.message }); return }
    setNote({ type: 'ok', text: data ?? 'Schedule updated.' })
    loadSchedule()
  }

  async function runHealth() {
    setHealth(h => ({ ...h, running: true }))
    const results = []
    const time = async (name, group, fn) => {
      const t0 = performance.now()
      try {
        const detail = await fn()
        results.push({ name, group, ok: true, detail: detail ?? `${Math.round(performance.now() - t0)}ms` })
      } catch (e) {
        results.push({ name, group, ok: false, detail: (e?.message ?? String(e)).slice(0, 80) })
      }
    }
    const headCount = table => async () => {
      const { count, error } = await supabase.from(table).select('id', { count: 'exact', head: true })
      if (error) throw error
      return `${count ?? 0} rows`
    }

    // Server
    const p0 = performance.now()
    const { error: pingErr } = await supabase.from('clients').select('id', { count: 'exact', head: true })
    const dbPing = Math.round(performance.now() - p0)

    await time('Database (Supabase)', 'Server', async () => { if (pingErr) throw pingErr; return `${dbPing}ms response` })
    await time('Auth session', 'Server', async () => { const { data } = await supabase.auth.getSession(); if (!data.session) throw new Error('no session'); return 'authenticated' })
    await time('Edge function (admin-user-actions)', 'Server', async () => {
      const { data, error } = await supabase.functions.invoke('admin-user-actions', { body: { action: 'ping' } })
      if (error) {
        let msg = error.message
        try { const b = await error.context?.json(); if (b?.error) msg = `${b.error} (${error.context?.status ?? '?'})` } catch { /* noop */ }
        throw new Error(msg)
      }
      if (data?.error) throw new Error(data.error)
      return `ok (${data?.role ?? 'admin'})`
    })

    // Data tables
    for (const t of ['clients', 'projects', 'project_phases', 'project_pathways', 'project_milestones', 'project_members', 'phase_content', 'surveys', 'stakeholders', 'industries', 'roles', 'user_activities', 'project_invites', 'templates', 'ai_usage', 'change_artifacts'])
      await time(t, 'Data', headCount(t))

    // Permissions / RPC helpers
    await time('admin_user_meta()', 'Permissions', async () => { const { data, error } = await supabase.rpc('admin_user_meta'); if (error) throw error; return `${(data ?? []).length} users` })
    await time('is_admin()', 'Permissions', async () => { const { data, error } = await supabase.rpc('is_admin'); if (error) throw error; return String(data) })
    await time('my_client_id()', 'Permissions', async () => { const { error } = await supabase.rpc('my_client_id'); if (error) throw error; return 'ok' })

    setHealth({ ran: true, running: false, checks: results, dbPing, at: new Date() })

    // Persist this run to history (server-side), then refresh the history table.
    try { await supabase.functions.invoke('health-check', { body: { source: 'manual' } }) } catch { /* history is best-effort */ }
    loadHealthHistory()
  }

  // ── AI Usage ─────────────────────────────────────────────────────────────────
  const [ai, setAi] = useState(null)        // recent detail (last 7 days) — null = not loaded yet
  const [aiSummary, setAiSummary] = useState(null)   // server-side per-tenant aggregates (whole retained dataset)
  const [aiRange, setAiRange] = useState('all')      // aggregate window: 'all' | '90' | '30' | '7' (days)
  const [aiSearch, setAiSearch] = useState('')       // filter the breakdown tables by client/project name
  const [history, setHistory] = useState(null)       // older-than-7-days rows, loaded on demand (paged)
  const [histDone, setHistDone] = useState(false)    // no more history pages
  const [histBusy, setHistBusy] = useState(false)
  const AI_RANGES = [['all', 'All time'], ['90', '90 days'], ['30', '30 days'], ['7', '7 days']]
  const HIST_PAGE = 100

  const sinceFor = range => {
    if (range === 'all') return null
    const d = new Date(); d.setDate(d.getDate() - Number(range)); return d.toISOString()
  }
  const sevenDaysAgo = () => { const d = new Date(); d.setDate(d.getDate() - 7); return d.toISOString() }

  async function loadAiUsage(range = aiRange) {
    // Recent detail = last 7 days only (kept small); the RPC aggregates the whole retained dataset
    // for accurate, searchable per-client/project totals. Both are RLS-scoped.
    const since = sinceFor(range)
    const [{ data: rows }, sum] = await Promise.all([
      supabase.from('ai_usage').select('*').gte('created_at', sevenDaysAgo()).order('created_at', { ascending: false }).limit(200),
      supabase.rpc('ai_usage_by_tenant', { p_since: since }),
    ])
    setAi(rows ?? [])
    setAiSummary(sum.error ? null : (sum.data ?? []))   // null → UI falls back to grouping the recent sample
    setHistory(null); setHistDone(false)                // reset history when (re)loading
  }
  function setAiRangeAndLoad(range) { setAiRange(range); setAiSummary(null); loadAiUsage(range) }

  // History: rows older than 7 days, fetched only when the admin opens it, one page at a time.
  async function loadHistory(reset = false) {
    setHistBusy(true)
    const offset = reset ? 0 : (history?.length ?? 0)
    const { data } = await supabase.from('ai_usage').select('*')
      .lt('created_at', sevenDaysAgo()).order('created_at', { ascending: false })
      .range(offset, offset + HIST_PAGE - 1)
    const rows = data ?? []
    setHistory(reset || history === null ? rows : [...history, ...rows])
    setHistDone(rows.length < HIST_PAGE)
    setHistBusy(false)
  }

  // ── E2E Tests (Playwright run history) ────────────────────────────────────────
  const [e2e, setE2e] = useState(null)
  const [expandedE2e, setExpandedE2e] = useState(null)
  const [e2eSched, setE2eSched] = useState(null)     // { active, interval_minutes, cron }
  const [e2eBusy, setE2eBusy] = useState(false)
  const E2E_INTERVALS = [[0, 'Off'], [360, '6 hours'], [720, '12 hours'], [1440, 'Daily']]

  // While a triggered run is in flight we poll for the new row, so the admin doesn't have to
  // refresh manually. baselineRef holds the newest run id at trigger time.
  const [e2eRunning, setE2eRunning] = useState(false)
  const [e2eElapsed, setE2eElapsed] = useState(0)
  const baselineRef = useRef(null)
  const pollRef = useRef(null)
  const tickRef = useRef(null)

  function stopPolling() {
    clearInterval(pollRef.current); clearInterval(tickRef.current)
    pollRef.current = null; tickRef.current = null
    setE2eRunning(false); setE2eElapsed(0)
  }
  useEffect(() => () => stopPolling(), [])   // clean up on unmount

  async function loadE2e() {
    const [{ data }, sched] = await Promise.all([
      supabase.from('e2e_runs').select('*').order('ran_at', { ascending: false }).limit(20),
      supabase.rpc('get_e2e_schedule'),
    ])
    const rows = data ?? []
    setE2e(rows)
    setE2eSched(sched.error ? null : (sched.data?.[0] ?? { active: false, interval_minutes: null, cron: null }))
    // A new run landed → stop waiting.
    if (pollRef.current && rows[0]?.id && rows[0].id !== baselineRef.current) {
      stopPolling()
      setNote({ type: 'ok', text: `Run finished — ${rows[0].passed} passed, ${rows[0].failed} failed.` })
    }
    return rows
  }

  // Kick off a run now — dispatches the GitHub workflow; we then poll until the result arrives.
  async function runE2eNow() {
    setE2eBusy(true); setNote(null)
    const { data, error } = await supabase.functions.invoke('e2e-trigger', { body: { source: 'manual' } })
    setE2eBusy(false)
    if (error || data?.error) { setNote({ type: 'err', text: data?.error ?? error?.message ?? 'Could not start the run.' }); return }
    setNote({ type: 'ok', text: 'E2E run started on the server — this page will update automatically when it finishes.' })
    baselineRef.current = e2e?.[0]?.id ?? null
    setE2eRunning(true); setE2eElapsed(0)
    tickRef.current = setInterval(() => setE2eElapsed(s => s + 1), 1000)
    pollRef.current = setInterval(() => { loadE2e() }, 10_000)
    // Give up waiting after 6 minutes (the run may still complete — just hit Refresh).
    setTimeout(() => { if (pollRef.current) { stopPolling(); setNote({ type: 'ok', text: 'Still running — press Refresh in a moment to see the result.' }) } }, 360_000)
  }
  async function setE2eSchedule(minutes) {
    setE2eBusy(true); setNote(null)
    const { data, error } = await supabase.rpc('set_e2e_schedule', { p_minutes: minutes })
    setE2eBusy(false)
    if (error) setNote({ type: 'err', text: error.message.includes('e2e_cron_config') ? 'Schedule store not set up — run add_e2e_schedule.sql and insert the URL + secret.' : error.message })
    else { setNote({ type: 'ok', text: data }); loadE2e() }
  }

  // ── Notifications (admin config) ──────────────────────────────────────────────
  const [notif, setNotif] = useState(null)
  const [notifBusy, setNotifBusy] = useState(false)
  async function loadNotif() {
    const { data } = await supabase.from('notification_config').select('*').eq('id', true).single()
    setNotif(data ?? { trigger: 'mentions', cadence: 'digest', digest_minutes: 15, email_enabled: true, push_enabled: true, vapid_public: '' })
  }
  async function saveNotif(patch) {
    const next = { ...notif, ...patch }
    setNotif(next); setNotifBusy(true); setNote(null)
    const { error } = await supabase.from('notification_config').update({
      trigger: next.trigger, cadence: next.cadence, digest_minutes: Number(next.digest_minutes) || 15,
      email_enabled: next.email_enabled, push_enabled: next.push_enabled, vapid_public: next.vapid_public || null,
      updated_at: new Date().toISOString(),
    }).eq('id', true)
    setNotifBusy(false)
    setNote(error ? { type: 'err', text: error.message } : { type: 'ok', text: 'Notification settings saved.' })
  }
  async function setNotifySchedule(minutes) {
    setNotifBusy(true); setNote(null)
    const { data, error } = await supabase.rpc('set_notify_schedule', { p_minutes: minutes })
    setNotifBusy(false)
    if (error) setNote({ type: 'err', text: error.message.includes('notify_cron_config') ? 'Delivery store not set up — run add_chat_notifications.sql and insert the URL + secret.' : error.message })
    else setNote({ type: 'ok', text: data ?? 'Delivery schedule updated.' })
  }

  const clientName = id => clients.find(c => c.id === id)?.name ?? '—'
  const projNameOf = id => projects.find(p => p.id === id)?.name ?? '—'
  const toggleSlm  = () => setSlmOn(setSlmOptedIn(!slmOn))
  const roleLabel  = code => allRoles.find(r => r.code === code)?.label ?? (code ? code.toUpperCase() : '—')
  const fmtDate    = d => d ? new Date(d).toLocaleDateString('en', { day: 'numeric', month: 'short', year: '2-digit' }) : '—'

  const q = search.trim().toLowerCase()
  const filtered = users.filter(u => {
    if (clientFilter === '__none' && u.client_id) return false
    if (clientFilter && clientFilter !== '__none' && u.client_id !== clientFilter) return false
    if (q && !`${u.name} ${u.email ?? ''}`.toLowerCase().includes(q)) return false
    return true
  })
  const accessBadge = a => a === 'Master Admin' ? 'bg-purple-100 text-purple-700'
    : a === 'Client Admin' ? 'bg-[#1F4E79]/10 text-[#1F4E79]' : 'bg-slate-100 text-slate-500'

  const clientAdmins = users.filter(u => u.access === 'Client Admin').length
  const unassigned   = users.filter(u => !u.client_id).length

  return (
    <div>
      <div className="mb-4">
        <h2 className="text-lg font-bold text-slate-800">{scoped ? 'Users' : 'System Admin'}</h2>
        <p className="text-xs text-slate-400 mt-0.5">{scoped ? 'Manage the people in your client.' : 'Platform-wide oversight for Master Admins.'}</p>
      </div>

      {/* Sub-navigation */}
      <div className="flex gap-1 bg-slate-100 rounded-xl p-1 mb-6 w-fit">
        {subtabs.map(t => (
          <button key={t} onClick={() => { setTab(t); if (t === 'System Health') { loadHealthHistory(); loadSchedule(); if (!health.ran) runHealth() } if (t === 'AI Usage' && ai === null) loadAiUsage(); if (t === 'Notifications' && notif === null) loadNotif(); if (t === 'E2E Tests' && e2e === null) loadE2e() }}
            className={`px-4 py-1.5 rounded-lg text-sm font-semibold transition-colors ${tab === t ? 'bg-white text-[#1F4E79] shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>
            {t}{t === 'Pending Invites' && invites.length > 0 ? ` (${invites.length})` : ''}
          </button>
        ))}
      </div>

      {note && (
        <div className={`mb-4 rounded-lg px-4 py-2.5 text-sm ${note.type === 'ok' ? 'bg-green-50 border border-green-200 text-green-700' : 'bg-red-50 border border-red-200 text-red-600'}`}>
          {note.type === 'ok' ? '✓ ' : '⚠ '}{note.text}
        </div>
      )}

      {/* ── USER MANAGEMENT ── */}
      {tab === 'User Management' && (
        <div>
          <div className={`grid ${scoped ? 'grid-cols-3' : 'grid-cols-4'} gap-3 mb-5`}>
            {(scoped ? [
              { v: users.length, l: 'Total users' },
              { v: clientAdmins, l: 'Client admins' },
              { v: users.filter(u => u.access === 'Member').length, l: 'Members' },
            ] : [
              { v: users.length, l: 'Total users' },
              { v: clients.length, l: 'Clients' },
              { v: clientAdmins, l: 'Client admins' },
              { v: unassigned, l: 'Unassigned' },
            ]).map((m, i) => (
              <div key={i} className="bg-white rounded-xl border border-slate-100 p-4">
                <p className="text-2xl font-bold text-[#1F4E79]">{m.v}</p>
                <p className="text-[11px] text-slate-400 mt-1 font-medium">{m.l}</p>
              </div>
            ))}
          </div>

          <div className="flex flex-wrap gap-3 mb-4">
            {!scoped && (
              <select value={clientFilter} onChange={e => setClientFilter(e.target.value)}
                className="border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:border-[#1F4E79] min-w-[200px]">
                <option value="">All clients</option>
                {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                <option value="__none">— Unassigned</option>
              </select>
            )}
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search by name or email…"
              className="flex-1 min-w-[220px] border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#1F4E79]" />
            <span className="flex items-center text-xs text-slate-400 px-2">{filtered.length} users</span>
          </div>

          {loading ? (
            <div className="space-y-2">{[1,2,3,4].map(n => <div key={n} className="h-14 bg-slate-100 rounded-xl animate-pulse" />)}</div>
          ) : filtered.length === 0 ? (
            <div className="text-center py-14 bg-slate-50 rounded-xl border border-slate-200 text-slate-400 text-sm">No users match.</div>
          ) : (
            <div className="bg-white border border-slate-200 rounded-xl overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-slate-50 text-left text-[11px] font-semibold text-slate-400 uppercase tracking-wide [&>th]:whitespace-nowrap [&>th]:align-middle [&>th]:font-semibold">
                    <th className="py-2.5 px-3">User</th><th className="py-2.5 px-3">Client</th>
                    <th className="py-2.5 px-3">Access</th><th className="py-2.5 px-3">Persona</th>
                    <th className="py-2.5 px-3">Projects</th><th className="py-2.5 px-3">Last sign-in</th>
                    <th className="py-2.5 px-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map(u => (
                    <tr key={u.id} className="border-t border-slate-100 hover:bg-slate-50/60 [&>td]:align-middle">
                      <td className="py-2.5 px-3">
                        <div className="flex items-center gap-2.5">
                          <div className="w-7 h-7 rounded-full bg-[#1F4E79]/10 flex items-center justify-center text-[11px] font-bold text-[#1F4E79] shrink-0">
                            {(u.name ?? '?').split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2)}
                          </div>
                          <div className="min-w-0">
                            <p className="font-medium text-slate-800 truncate">{u.name}</p>
                            <p className="text-[11px] text-slate-400 truncate">{u.email ?? '—'}</p>
                          </div>
                        </div>
                      </td>
                      <td className="py-2.5 px-3 text-slate-600 whitespace-nowrap">{u.client_id ? clientName(u.client_id) : <span className="text-slate-300">—</span>}</td>
                      <td className="py-2.5 px-3 whitespace-nowrap">
                        <span className={`inline-block text-[10px] font-semibold px-2 py-0.5 rounded-full whitespace-nowrap ${accessBadge(u.access)}`}>{u.access}</span>
                        {u.locked && <span className="ml-1 inline-block text-[10px] font-semibold px-2 py-0.5 rounded-full bg-red-100 text-red-700 whitespace-nowrap">Locked</span>}
                      </td>
                      <td className="py-2.5 px-3 text-slate-600 whitespace-nowrap">{roleLabel(u.role)}</td>
                      <td className="py-2.5 px-3">
                        {u.projects.length === 0 ? <span className="text-slate-300">—</span> : (
                          <span className="text-slate-600 text-xs">{u.projects.slice(0, 2).join(', ')}{u.projects.length > 2 ? ` +${u.projects.length - 2}` : ''}</span>
                        )}
                      </td>
                      <td className="py-2.5 px-3 text-slate-500 text-xs whitespace-nowrap">{u.lastSignIn ? fmtDate(u.lastSignIn) : <span className="text-slate-300">never</span>}</td>
                      <td className="py-2.5 px-3">
                        <div className="flex items-center justify-end gap-1">
                          <button onClick={() => openEdit(u)} disabled={busy} title="Edit" aria-label="Edit"
                            className="p-1.5 rounded-lg text-slate-500 hover:text-[#1F4E79] hover:bg-slate-100 disabled:opacity-40">
                            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z"/></svg>
                          </button>
                          <button onClick={() => doReset(u)} disabled={busy || !u.email} title="Send reset link" aria-label="Send reset link"
                            className="p-1.5 rounded-lg text-slate-500 hover:text-[#1F4E79] hover:bg-slate-100 disabled:opacity-40">
                            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="7.5" cy="15.5" r="4.5"/><path d="m10.5 12.5 9-9m-3 0 3 3m-5 2 2 2"/></svg>
                          </button>
                          <button onClick={() => doLock(u)} disabled={busy} title={u.locked ? 'Unlock' : 'Lock'} aria-label={u.locked ? 'Unlock' : 'Lock'}
                            className={`p-1.5 rounded-lg hover:bg-slate-100 disabled:opacity-40 ${u.locked ? 'text-amber-500 hover:text-amber-600' : 'text-slate-500 hover:text-slate-700'}`}>
                            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="4" y="11" width="16" height="10" rx="2"/>{u.locked ? <path d="M8 11V7a4 4 0 0 1 7.5-2"/> : <path d="M8 11V7a4 4 0 0 1 8 0v4"/>}</svg>
                          </button>
                          <button onClick={() => doDelete(u)} disabled={busy} title="Delete" aria-label="Delete"
                            className="p-1.5 rounded-lg text-red-400 hover:text-red-600 hover:bg-red-50 disabled:opacity-40">
                            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m2 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/></svg>
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ── PENDING INVITES ── */}
      {tab === 'Pending Invites' && (
        loading ? (
          <div className="space-y-2">{[1,2,3].map(n => <div key={n} className="h-14 bg-slate-100 rounded-xl animate-pulse" />)}</div>
        ) : invites.length === 0 ? (
          <div className="text-center py-14 bg-slate-50 rounded-xl border border-slate-200 text-slate-400 text-sm">No pending invites.</div>
        ) : (
          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-50 text-left text-[11px] font-semibold text-slate-400 uppercase tracking-wide">
                  <th className="py-2.5 px-3">Email</th><th className="py-2.5 px-3">Client</th>
                  <th className="py-2.5 px-3">Project</th><th className="py-2.5 px-3">Persona</th>
                  <th className="py-2.5 px-3">As admin</th><th className="py-2.5 px-3">Invited</th>
                </tr>
              </thead>
              <tbody>
                {invites.map(i => (
                  <tr key={i.id} className="border-t border-slate-100 hover:bg-slate-50/60">
                    <td className="py-2.5 px-3">
                      <p className="font-medium text-slate-800">{i.email}</p>
                      {i.full_name && <p className="text-[11px] text-slate-400">{i.full_name}</p>}
                    </td>
                    <td className="py-2.5 px-3 text-slate-600">{clientName(i.client_id)}</td>
                    <td className="py-2.5 px-3 text-slate-600">{i.projectName ?? '—'}</td>
                    <td className="py-2.5 px-3 text-slate-600">{roleLabel(i.role)}</td>
                    <td className="py-2.5 px-3">{i.as_client_admin
                      ? <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-[#1F4E79]/10 text-[#1F4E79]">Client Admin</span>
                      : <span className="text-slate-300">—</span>}</td>
                    <td className="py-2.5 px-3 text-slate-500 text-xs whitespace-nowrap">{fmtDate(i.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      )}

      {/* ── SYSTEM HEALTH ── */}
      {tab === 'System Health' && (
        <div>
          <div className="flex items-center justify-between mb-4">
            <p className="text-xs text-slate-400">
              {health.at ? `Last checked: ${health.at.toLocaleTimeString('en', { hour: 'numeric', minute: '2-digit' })} · ${health.checks.filter(c => c.ok).length}/${health.checks.length} passing` : 'Not run yet'}
            </p>
            <button onClick={runHealth} disabled={health.running}
              className="text-sm font-semibold text-white bg-[#1F4E79] px-4 py-2 rounded-lg hover:bg-[#163a5c] disabled:opacity-60">
              {health.running ? 'Running…' : '↻ Run checks'}
            </button>
          </div>

          {/* Automated schedule — configurable interval (server-side pg_cron) */}
          {!scoped && (
            <div className="flex flex-wrap items-center justify-between gap-4 bg-white border border-slate-200 rounded-xl p-4 mb-6">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-slate-800">Automated checks</p>
                <p className="text-[11px] text-slate-400 mt-0.5">
                  {hsched == null ? 'Loading schedule…'
                    : hsched.interval_minutes
                      ? `Runs every ${hsched.interval_minutes < 60 ? `${hsched.interval_minutes} min` : 'hour'} on the server. Each run is recorded below.`
                      : 'Not scheduled — checks only run when you click “Run checks”.'}
                </p>
              </div>
              <div className="flex gap-1 bg-slate-100 rounded-lg p-1">
                {HEALTH_INTERVALS.map(([m, l]) => {
                  const active = hsched && (hsched.interval_minutes ?? 0) === m
                  return (
                    <button key={m} onClick={() => saveSchedule(m)} disabled={hschedBusy}
                      className={`px-3 py-1 rounded-md text-xs font-semibold transition-colors disabled:opacity-50 ${active ? 'bg-white text-[#1F4E79] shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>{l}</button>
                  )
                })}
              </div>
            </div>
          )}

          {/* Status cards */}
          <div className="grid grid-cols-4 gap-3 mb-6">
            {[
              { l: 'API status', v: health.ran ? (health.checks.find(c => c.name === 'Database (Supabase)')?.ok ? 'Online ✓' : 'Degraded') : '—', c: 'text-green-600' },
              { l: 'DB ping', v: health.dbPing != null ? `${health.dbPing}ms` : '—', c: 'text-[#1F4E79]' },
              { l: 'Checks passing', v: health.ran ? `${health.checks.filter(c => c.ok).length}/${health.checks.length}` : '—', c: health.ran && health.checks.every(c => c.ok) ? 'text-green-600' : 'text-[#E8913A]' },
              { l: 'Environment', v: 'React + Vite', c: 'text-slate-700' },
            ].map((m, i) => (
              <div key={i} className="bg-white rounded-xl border border-slate-100 p-4">
                <p className="text-[10px] text-slate-400 uppercase tracking-widest font-semibold">{m.l}</p>
                <p className={`text-xl font-bold mt-1 ${m.c}`}>{m.v}</p>
              </div>
            ))}
          </div>

          {/* Checks by group */}
          {health.running && health.checks.length === 0 ? (
            <div className="space-y-2">{[1,2,3,4].map(n => <div key={n} className="h-10 bg-slate-100 rounded-lg animate-pulse" />)}</div>
          ) : (
            ['Server', 'Data', 'Permissions'].map(group => {
              const rows = health.checks.filter(c => c.group === group)
              if (!rows.length) return null
              return (
                <div key={group} className="mb-5">
                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2">{group}</p>
                  <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
                    {rows.map((c, i) => (
                      <div key={c.name} className={`flex items-center justify-between px-4 py-2.5 text-sm ${i > 0 ? 'border-t border-slate-100' : ''}`}>
                        <span className="flex items-center gap-2 text-slate-700">
                          <span className={`w-2 h-2 rounded-full ${c.ok ? 'bg-green-500' : 'bg-red-500'}`} />
                          {c.name}
                        </span>
                        <span className={`text-xs ${c.ok ? 'text-slate-400' : 'text-red-500 font-medium'}`}>{c.detail}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )
            })
          )}

          {/* Run history (scheduled + manual) */}
          {healthHistory.length > 0 && (() => {
            const lastScheduled = healthHistory.find(r => r.source === 'scheduled')
            const rate = r => r.total > 0 ? Math.round((r.passed / r.total) * 100) : 0
            return (
              <div className="mt-6">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Run history</p>
                  {lastScheduled && (
                    <p className="text-[11px] text-slate-400">
                      Last scheduled: {new Date(lastScheduled.ran_at).toLocaleString('en', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })} · {rate(lastScheduled)}%
                    </p>
                  )}
                </div>
                <p className="text-[11px] text-slate-400 mb-2">Click a run to see the detail of every check it executed.</p>
                <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-slate-50 text-left text-[11px] font-semibold text-slate-400 uppercase tracking-wide">
                        <th className="py-2 px-3 w-6"></th><th className="py-2 px-3">Time</th><th className="py-2 px-3">Source</th>
                        <th className="py-2 px-3">Passed</th><th className="py-2 px-3">Failed</th><th className="py-2 px-3">Pass rate</th><th className="py-2 px-3">Duration</th>
                      </tr>
                    </thead>
                    <tbody>
                      {healthHistory.map(r => {
                        const open = expandedRun === r.id
                        const checks = Array.isArray(r.checks) ? r.checks : []
                        return (
                          <Fragment key={r.id}>
                            <tr onClick={() => setExpandedRun(open ? null : r.id)} className="border-t border-slate-100 cursor-pointer hover:bg-slate-50/60">
                              <td className="py-2 px-3 text-slate-400 text-xs">{open ? '▾' : '▸'}</td>
                              <td className="py-2 px-3 text-slate-600 text-xs whitespace-nowrap">{new Date(r.ran_at).toLocaleString('en', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}</td>
                              <td className="py-2 px-3">
                                <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${r.source === 'scheduled' ? 'bg-amber-100 text-amber-700' : 'bg-slate-100 text-slate-500'}`}>{r.source}</span>
                              </td>
                              <td className="py-2 px-3 text-green-600 font-medium">{r.passed}</td>
                              <td className={`py-2 px-3 font-medium ${r.failed > 0 ? 'text-red-600' : 'text-slate-300'}`}>{r.failed}</td>
                              <td className="py-2 px-3"><span className={`text-xs font-semibold ${rate(r) === 100 ? 'text-green-600' : 'text-[#E8913A]'}`}>{rate(r)}%</span></td>
                              <td className="py-2 px-3 text-slate-400 text-xs whitespace-nowrap">{r.duration_ms != null ? `${r.duration_ms}ms` : '—'}</td>
                            </tr>
                            {open && (
                              <tr className="bg-slate-50/60"><td /><td colSpan={6} className="px-3 py-3">
                                {checks.length === 0 ? <p className="text-xs text-slate-400">No per-check detail recorded for this run.</p> : (
                                  <div className="grid gap-1 sm:grid-cols-2">
                                    {checks.map((c, i) => (
                                      <div key={i} className="flex items-center justify-between gap-2 bg-white border border-slate-100 rounded-lg px-2.5 py-1.5">
                                        <span className="flex items-center gap-2 text-[12px] text-slate-700 min-w-0">
                                          <span className={`w-2 h-2 rounded-full shrink-0 ${c.ok ? 'bg-green-500' : 'bg-red-500'}`} />
                                          <span className="truncate">{c.name}{c.group ? <span className="text-slate-300"> · {c.group}</span> : ''}</span>
                                        </span>
                                        <span className={`text-[11px] whitespace-nowrap ${c.ok ? 'text-slate-400' : 'text-red-500 font-medium'}`}>{c.detail}</span>
                                      </div>
                                    ))}
                                  </div>
                                )}
                              </td></tr>
                            )}
                          </Fragment>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )
          })()}
        </div>
      )}

      {/* ── AI USAGE ── */}
      {tab === 'AI Usage' && (() => {
        if (ai === null) return <div className="space-y-2">{[1,2,3,4].map(n => <div key={n} className="h-14 bg-slate-100 rounded-xl animate-pulse" />)}</div>
        const useSummary = Array.isArray(aiSummary)
        const tierBadge = t => t === 'rules' ? 'bg-green-100 text-green-700' : t === 'slm' ? 'bg-blue-100 text-blue-700' : 'bg-amber-100 text-amber-700'

        // Per-tenant rows: prefer the server aggregate (whole dataset); fall back to grouping the
        // recent sample if the RPC isn't available yet (pre-migration).
        const fromSummary = sc => aiSummary.filter(s => s.scope === sc).map(s => ({
          key: s.id ?? '__none', name: s.id ? (s.name ?? (sc === 'client' ? clientName(s.id) : projNameOf(s.id))) : 'Unattributed',
          n: Number(s.queries), ext: Number(s.external), avg: s.avg_latency ?? null,
        })).sort((a, b) => b.n - a.n)
        const groupBy = (field, nameFn) => {
          const m = new Map()
          ai.forEach(r => {
            const key = r[field] ?? '__none'
            const g = m.get(key) ?? { key, name: r[field] ? nameFn(r[field]) : 'Unattributed', n: 0, ext: 0, lat: 0, latN: 0 }
            g.n++; if (r.tier === 'external') g.ext++
            if (r.latency_ms != null) { g.lat += r.latency_ms; g.latN++ }
            m.set(key, g)
          })
          return [...m.values()].map(g => ({ ...g, avg: g.latN ? Math.round(g.lat / g.latN) : null })).sort((a, b) => b.n - a.n)
        }
        const byClient  = useSummary ? fromSummary('client')  : groupBy('client_id', clientName)
        const byProject = (useSummary ? fromSummary('project') : groupBy('project_id', projNameOf)).filter(g => g.key !== '__none')

        // Headline totals: from the aggregate when available (accurate at any scale), else the sample.
        let total, rules, slm, ext, avgLat
        if (useSummary) {
          const cr = aiSummary.filter(s => s.scope === 'client')
          const sum = f => cr.reduce((a, s) => a + Number(s[f] || 0), 0)
          total = sum('queries'); rules = sum('rules'); slm = sum('slm'); ext = sum('external')
          const wl = cr.filter(s => s.avg_latency != null)
          const wn = wl.reduce((a, s) => a + Number(s.queries), 0)
          avgLat = wn ? Math.round(wl.reduce((a, s) => a + s.avg_latency * Number(s.queries), 0) / wn) : 0
        } else {
          total = ai.length
          const byTier = t => ai.filter(r => r.tier === t).length
          rules = byTier('rules'); slm = byTier('slm'); ext = byTier('external')
          const withLat = ai.filter(r => r.latency_ms != null)
          avgLat = withLat.length ? Math.round(withLat.reduce((s, r) => s + r.latency_ms, 0) / withLat.length) : 0
        }
        const localPct = total ? Math.round(((rules + slm) / total) * 100) : 0
        const extPct   = total ? Math.round((ext / total) * 100) : 0
        const seg = [{ t: 'rules', n: rules, c: '#16A34A' }, { t: 'slm', n: slm, c: '#2563EB' }, { t: 'external', n: ext, c: '#D97706' }]

        // Search narrows the breakdown tables so the list stays usable as clients grow.
        const sq = aiSearch.trim().toLowerCase()
        const filt = rows => sq ? rows.filter(r => r.name.toLowerCase().includes(sq)) : rows
        const breakdown = (title, rows) => {
          const shown = filt(rows)
          if (rows.length === 0) return null
          return (
          <div className="mb-6">
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2">{title} <span className="text-slate-300 normal-case tracking-normal">({shown.length}{sq ? ` of ${rows.length}` : ''})</span></p>
            <div className="bg-white border border-slate-200 rounded-xl overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-slate-50 text-left text-[11px] font-semibold text-slate-400 uppercase tracking-wide [&>th]:whitespace-nowrap">
                    <th className="py-2.5 px-3">{title.replace('By ', '')}</th><th className="py-2.5 px-3 text-right">Queries</th>
                    <th className="py-2.5 px-3">Share</th><th className="py-2.5 px-3 text-right">External</th><th className="py-2.5 px-3 text-right">Avg latency</th>
                  </tr>
                </thead>
                <tbody>
                  {shown.length === 0 ? (
                    <tr><td colSpan={5} className="py-6 text-center text-slate-400 text-xs">No match for “{aiSearch}”.</td></tr>
                  ) : shown.map(g => (
                    <tr key={g.key} className="border-t border-slate-100">
                      <td className="py-2 px-3 text-slate-700 whitespace-nowrap">{g.name === 'Unattributed' ? <span className="text-slate-400">{g.name}</span> : g.name}</td>
                      <td className="py-2 px-3 text-right text-slate-700 font-medium">{g.n}</td>
                      <td className="py-2 px-3 w-[34%]">
                        <div className="flex items-center gap-2">
                          <div className="flex-1 h-2 rounded-full bg-slate-100 overflow-hidden"><div className="h-full bg-[#1F4E79]" style={{ width: `${total ? (g.n / total) * 100 : 0}%` }} /></div>
                          <span className="text-[11px] text-slate-400 w-9 text-right">{total ? Math.round((g.n / total) * 100) : 0}%</span>
                        </div>
                      </td>
                      <td className="py-2 px-3 text-right text-xs"><span className={g.ext > 0 ? 'text-amber-600 font-medium' : 'text-slate-300'}>{g.ext}</span></td>
                      <td className="py-2 px-3 text-right text-slate-400 text-xs whitespace-nowrap">{g.avg != null ? `${g.avg}ms` : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          )
        }
        // Shared detail-log table — used by both "Recent" (7 days) and "History" (older, paged).
        const queryTable = rows => (
          <div className="bg-white border border-slate-200 rounded-xl overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-50 text-left text-[11px] font-semibold text-slate-400 uppercase tracking-wide [&>th]:whitespace-nowrap">
                  <th className="py-2.5 px-3">Time</th><th className="py-2.5 px-3">Tier</th>
                  {!scoped && <th className="py-2.5 px-3">Client</th>}<th className="py-2.5 px-3">Project</th>
                  <th className="py-2.5 px-3">Intent</th><th className="py-2.5 px-3">Query</th><th className="py-2.5 px-3 text-right">Latency</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(r => (
                  <tr key={r.id} className="border-t border-slate-100">
                    <td className="py-2 px-3 text-slate-500 text-xs whitespace-nowrap">{new Date(r.created_at).toLocaleString('en', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}</td>
                    <td className="py-2 px-3"><span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${tierBadge(r.tier)}`}>{r.tier}</span></td>
                    {!scoped && <td className="py-2 px-3 text-slate-600 text-xs whitespace-nowrap">{r.client_id ? clientName(r.client_id) : <span className="text-slate-300">—</span>}</td>}
                    <td className="py-2 px-3 text-slate-600 text-xs whitespace-nowrap">{r.project_id ? projNameOf(r.project_id) : <span className="text-slate-300">—</span>}</td>
                    <td className="py-2 px-3 text-slate-600 text-xs whitespace-nowrap">{r.intent ?? '—'}</td>
                    <td className="py-2 px-3 text-slate-600 text-xs max-w-[280px] truncate" title={r.query}>{r.query ?? '—'}</td>
                    <td className="py-2 px-3 text-slate-400 text-xs text-right whitespace-nowrap">{r.latency_ms != null ? `${r.latency_ms}ms` : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
        return (
          <div>
            <div className="flex items-center justify-between mb-4">
              <p className="text-xs text-slate-400">Where AI queries are being answered — Rules and the on-device model cost nothing and stay private; external is the only paid, off-device path.</p>
              <button onClick={loadAiUsage} className="text-sm font-semibold text-white bg-[#1F4E79] px-4 py-2 rounded-lg hover:bg-[#163a5c]">↻ Refresh</button>
            </div>

            {/* On-device AI (SLM) toggle — per-device capability switch */}
            <div className="flex items-center justify-between gap-4 bg-white border border-slate-200 rounded-xl p-4 mb-5">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-slate-800">On-device AI (private model)</p>
                <p className="text-[11px] text-slate-400 mt-0.5">
                  Runs a small model in your browser for open-ended questions — $0 and fully private (nothing leaves this device). Downloads a few hundred MB on first use. This setting applies to this browser only.
                  {!webgpuSupported() && <span className="text-amber-600 font-medium"> This browser doesn’t support WebGPU, so it can’t run here.</span>}
                </p>
              </div>
              <button role="switch" aria-checked={slmOn} onClick={toggleSlm} disabled={!webgpuSupported() && !slmOn}
                className={`relative shrink-0 w-11 h-6 rounded-full transition-colors ${slmOn ? 'bg-[#1F4E79]' : 'bg-slate-300'} disabled:opacity-40`}>
                <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${slmOn ? 'translate-x-5' : ''}`} />
              </button>
            </div>

            {/* Time window + search — keep the breakdown usable as the client base grows */}
            <div className="flex flex-wrap items-center gap-3 mb-4">
              <div className="flex gap-1 bg-slate-100 rounded-lg p-1">
                {AI_RANGES.map(([v, l]) => (
                  <button key={v} onClick={() => setAiRangeAndLoad(v)}
                    className={`px-3 py-1 rounded-md text-xs font-semibold transition-colors ${aiRange === v ? 'bg-white text-[#1F4E79] shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>{l}</button>
                ))}
              </div>
              {!scoped && (
                <input value={aiSearch} onChange={e => setAiSearch(e.target.value)} placeholder="Search client or project…"
                  className="flex-1 min-w-[200px] border border-slate-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:border-[#1F4E79]" />
              )}
              <span className="text-[11px] text-slate-400">{useSummary ? 'Whole dataset' : 'Recent sample'}{aiRange !== 'all' ? ` · last ${aiRange}d` : ''}</span>
            </div>

            <div className="grid grid-cols-4 gap-3 mb-5">
              {[
                { l: 'Total queries', v: total, c: 'text-[#1F4E79]' },
                { l: 'Answered locally', v: `${localPct}%`, c: 'text-green-600' },
                { l: 'Escalated (external)', v: `${extPct}%`, c: extPct > 0 ? 'text-amber-600' : 'text-slate-400' },
                { l: 'Avg latency', v: `${avgLat}ms`, c: 'text-[#1F4E79]' },
              ].map((m, i) => (
                <div key={i} className="bg-white rounded-xl border border-slate-100 p-4">
                  <p className={`text-2xl font-bold ${m.c}`}>{m.v}</p>
                  <p className="text-[11px] text-slate-400 mt-1 font-medium">{m.l}</p>
                </div>
              ))}
            </div>

            {total === 0 ? (
              <div className="text-center py-14 bg-slate-50 rounded-xl border border-slate-200 text-slate-400 text-sm">No CORA queries logged yet. Try asking CORA.</div>
            ) : (
              <>
                {/* Tier split */}
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2">By tier</p>
                <div className="flex h-3 rounded-full overflow-hidden mb-2 bg-slate-100">
                  {seg.filter(s => s.n > 0).map(s => <div key={s.t} style={{ width: `${(s.n / total) * 100}%`, background: s.c }} />)}
                </div>
                <div className="flex gap-4 mb-6 text-xs text-slate-500">
                  {seg.map(s => <span key={s.t} className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full" style={{ background: s.c }} />{s.t} ({s.n})</span>)}
                </div>

                {/* Per-tenant breakdowns */}
                {!scoped && breakdown('By client', byClient)}
                {breakdown('By project', byProject)}

                {/* Recent queries — last 7 days only, so this list stays small */}
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2">Recent queries <span className="text-slate-300 normal-case tracking-normal">· last 7 days</span></p>
                {ai.length === 0
                  ? <div className="text-center py-8 bg-slate-50 rounded-xl border border-slate-200 text-slate-400 text-sm">No queries in the last 7 days.</div>
                  : queryTable(ai)}

                {/* History — older rows, fetched on demand and paged so nothing heavy loads upfront */}
                <div className="mt-6">
                  {history === null ? (
                    <button onClick={() => loadHistory(true)} disabled={histBusy}
                      className="text-sm font-semibold text-[#1F4E79] hover:underline disabled:opacity-50">
                      {histBusy ? 'Loading…' : 'View history (older than 7 days) →'}
                    </button>
                  ) : (
                    <>
                      <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2">History <span className="text-slate-300 normal-case tracking-normal">· older than 7 days{history.length ? ` · ${history.length} loaded` : ''}</span></p>
                      {history.length === 0
                        ? <div className="text-center py-8 bg-slate-50 rounded-xl border border-slate-200 text-slate-400 text-sm">No older queries.</div>
                        : queryTable(history)}
                      {!histDone && history.length > 0 && (
                        <div className="text-center mt-3">
                          <button onClick={() => loadHistory()} disabled={histBusy}
                            className="text-sm font-semibold text-[#1F4E79] hover:underline disabled:opacity-50">{histBusy ? 'Loading…' : 'Load more'}</button>
                        </div>
                      )}
                      <p className="text-[10px] text-slate-400 mt-3">Detail is retained for 180 days; per-client and per-project totals above cover the whole retained window.</p>
                    </>
                  )}
                </div>
              </>
            )}
          </div>
        )
      })()}

      {/* ── E2E TESTS ── */}
      {tab === 'E2E Tests' && (
        e2e === null ? <div className="space-y-2">{[1,2,3].map(n => <div key={n} className="h-14 bg-slate-100 rounded-xl animate-pulse" />)}</div> : (() => {
          const last = e2e[0]
          // Pass rate over *executed* tests — skipped ones shouldn't drag it down.
          const rate = r => {
            if (!r) return 0
            const executed = (r.total ?? 0) - (r.skipped ?? 0)
            return executed > 0 ? Math.round(((r.passed ?? 0) / executed) * 100) : 0
          }
          const badge = s => s === 'passed' ? 'bg-green-100 text-green-700' : s === 'skipped' ? 'bg-slate-100 text-slate-500' : 'bg-red-100 text-red-700'
          return (
            <div>
              <div className="flex items-center justify-between gap-3 mb-4">
                <p className="text-xs text-slate-400">Playwright end-to-end runs against the live app. Click a run to see every spec it executed.</p>
                <div className="flex items-center gap-2 shrink-0">
                  <button onClick={runE2eNow} disabled={e2eBusy || e2eRunning}
                    className="text-sm font-semibold text-white bg-[#1F4E79] px-4 py-2 rounded-lg hover:bg-[#163a5c] disabled:opacity-60">
                    {e2eBusy ? 'Starting…' : e2eRunning ? 'Running…' : '▶ Run tests now'}
                  </button>
                  <button onClick={loadE2e} className="text-sm font-semibold text-[#1F4E79] border border-slate-200 px-3 py-2 rounded-lg hover:bg-slate-50 whitespace-nowrap">↻ Refresh</button>
                </div>
              </div>

              {/* Live progress while a triggered run is in flight */}
              {e2eRunning && (
                <div className="flex items-center gap-3 bg-[#1F4E79]/5 border border-[#1F4E79]/20 rounded-xl px-4 py-3 mb-5">
                  <span className="w-4 h-4 rounded-full border-2 border-[#1F4E79]/30 border-t-[#1F4E79] animate-spin shrink-0" />
                  <div className="min-w-0">
                    <p className="text-[13px] font-semibold text-[#1F4E79]">Tests running on the server…</p>
                    <p className="text-[11px] text-slate-500">
                      {Math.floor(e2eElapsed / 60)}:{String(e2eElapsed % 60).padStart(2, '0')} elapsed · checking every 10s — results appear automatically. Typically 1–2 minutes.
                    </p>
                  </div>
                </div>
              )}

              {/* Automated schedule — server-side, admin controlled */}
              <div className="flex flex-wrap items-center justify-between gap-4 bg-white border border-slate-200 rounded-xl p-4 mb-5">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-slate-800">Automated runs</p>
                  <p className="text-[11px] text-slate-400 mt-0.5">
                    {e2eSched == null ? 'Loading schedule…'
                      : e2eSched.interval_minutes
                        ? `Runs every ${e2eSched.interval_minutes >= 1440 ? 'day' : `${e2eSched.interval_minutes / 60} hours`} automatically.`
                        : 'Not scheduled — runs only when you click “Run tests now”.'}
                  </p>
                </div>
                <div className="flex gap-1 bg-slate-100 rounded-lg p-1">
                  {E2E_INTERVALS.map(([m, l]) => {
                    const active = e2eSched && (e2eSched.interval_minutes ?? 0) === m
                    return (
                      <button key={m} onClick={() => setE2eSchedule(m)} disabled={e2eBusy}
                        className={`px-3 py-1 rounded-md text-xs font-semibold transition-colors disabled:opacity-50 ${active ? 'bg-white text-[#1F4E79] shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>{l}</button>
                    )
                  })}
                </div>
              </div>

              {e2e.length === 0 ? (
                <div className="text-center py-14 bg-slate-50 rounded-xl border border-slate-200 text-slate-400 text-sm">No E2E runs recorded yet — click <strong>Run tests now</strong>, or set an automated schedule above.</div>
              ) : (
                <>
                  <div className="grid grid-cols-4 gap-3 mb-5">
                    {[
                      { l: (last.skipped ?? 0) > 0 ? `Latest pass rate (${last.skipped} skipped)` : 'Latest pass rate', v: `${rate(last)}%`, c: rate(last) === 100 ? 'text-green-600' : 'text-[#E8913A]' },
                      { l: 'Passed', v: last.passed ?? 0, c: 'text-green-600' },
                      { l: 'Failed', v: last.failed ?? 0, c: (last.failed ?? 0) > 0 ? 'text-red-600' : 'text-slate-400' },
                      { l: 'Last run', v: new Date(last.ran_at).toLocaleDateString('en', { day: 'numeric', month: 'short' }), c: 'text-[#1F4E79]' },
                    ].map((m, i) => (
                      <div key={i} className="bg-white rounded-xl border border-slate-100 p-4">
                        <p className={`text-2xl font-bold ${m.c}`}>{m.v}</p>
                        <p className="text-[11px] text-slate-400 mt-1 font-medium">{m.l}</p>
                      </div>
                    ))}
                  </div>

                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2">Run history</p>
                  <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="bg-slate-50 text-left text-[11px] font-semibold text-slate-400 uppercase tracking-wide">
                          <th className="py-2 px-3 w-6"></th><th className="py-2 px-3">Time</th><th className="py-2 px-3">Source</th>
                          <th className="py-2 px-3">Passed</th><th className="py-2 px-3">Failed</th><th className="py-2 px-3">Skipped</th>
                          <th className="py-2 px-3">Pass rate</th><th className="py-2 px-3">Duration</th><th className="py-2 px-3">Commit</th>
                        </tr>
                      </thead>
                      <tbody>
                        {e2e.map(r => {
                          const open = expandedE2e === r.id
                          const specs = Array.isArray(r.specs) ? r.specs : []
                          return (
                            <Fragment key={r.id}>
                              <tr onClick={() => setExpandedE2e(open ? null : r.id)} className="border-t border-slate-100 cursor-pointer hover:bg-slate-50/60">
                                <td className="py-2 px-3 text-slate-400 text-xs">{open ? '▾' : '▸'}</td>
                                <td className="py-2 px-3 text-slate-600 text-xs whitespace-nowrap">{new Date(r.ran_at).toLocaleString('en', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}</td>
                                <td className="py-2 px-3"><span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-slate-100 text-slate-500">{r.source}</span></td>
                                <td className="py-2 px-3 text-green-600 font-medium">{r.passed}</td>
                                <td className={`py-2 px-3 font-medium ${r.failed > 0 ? 'text-red-600' : 'text-slate-300'}`}>{r.failed}</td>
                                <td className="py-2 px-3 text-slate-400">{r.skipped ?? 0}</td>
                                <td className="py-2 px-3"><span className={`text-xs font-semibold ${rate(r) === 100 ? 'text-green-600' : 'text-[#E8913A]'}`}>{rate(r)}%</span></td>
                                <td className="py-2 px-3 text-slate-400 text-xs whitespace-nowrap">{r.duration_ms != null ? `${(r.duration_ms / 1000).toFixed(1)}s` : '—'}</td>
                                <td className="py-2 px-3 text-slate-400 text-xs font-mono">{r.commit ? r.commit.slice(0, 7) : '—'}</td>
                              </tr>
                              {open && (
                                <tr className="bg-slate-50/60"><td /><td colSpan={8} className="px-3 py-3">
                                  {specs.length === 0 ? <p className="text-xs text-slate-400">No per-spec detail recorded.</p> : (
                                    <div className="space-y-1">
                                      {specs.map((s, i) => (
                                        <div key={i} className="flex items-center justify-between gap-3 bg-white border border-slate-100 rounded-lg px-2.5 py-1.5">
                                          <span className="flex items-center gap-2 text-[12px] text-slate-700 min-w-0">
                                            <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded ${badge(s.status)}`}>{s.status}</span>
                                            <span className="truncate">{s.title}{s.file ? <span className="text-slate-300"> · {s.file}</span> : ''}</span>
                                          </span>
                                          <span className="flex items-center gap-2 shrink-0">
                                            {s.error && <span className="text-[11px] text-red-500 max-w-[280px] truncate" title={s.error}>{s.error}</span>}
                                            <span className="text-[11px] text-slate-400 whitespace-nowrap">{s.duration_ms != null ? `${s.duration_ms}ms` : ''}</span>
                                          </span>
                                        </div>
                                      ))}
                                    </div>
                                  )}
                                </td></tr>
                              )}
                            </Fragment>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </div>
          )
        })()
      )}

      {/* ── NOTIFICATIONS ── */}
      {tab === 'Notifications' && (
        notif === null ? <div className="space-y-2">{[1,2,3].map(n => <div key={n} className="h-16 bg-slate-100 rounded-xl animate-pulse" />)}</div> : (
        <div className="space-y-5 max-w-2xl">
          <p className="text-xs text-slate-400">Control when CFM chat notifications are sent and how they’re delivered. Applies platform-wide.</p>

          {/* Trigger */}
          <div className="bg-white border border-slate-200 rounded-xl p-4">
            <p className="text-sm font-semibold text-slate-800 mb-1">Notify on</p>
            <p className="text-[11px] text-slate-400 mb-3">Which messages generate a notification.</p>
            <div className="flex gap-1 bg-slate-100 rounded-lg p-1 w-fit">
              {[['off', 'Off'], ['mentions', 'Mentions & DMs'], ['all', 'All messages']].map(([v, l]) => (
                <button key={v} onClick={() => saveNotif({ trigger: v })} disabled={notifBusy}
                  className={`px-3 py-1 rounded-md text-xs font-semibold transition-colors disabled:opacity-50 ${notif.trigger === v ? 'bg-white text-[#1F4E79] shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>{l}</button>
              ))}
            </div>
          </div>

          {/* Cadence */}
          <div className="bg-white border border-slate-200 rounded-xl p-4">
            <p className="text-sm font-semibold text-slate-800 mb-1">Cadence</p>
            <p className="text-[11px] text-slate-400 mb-3">Send immediately, or batch into a periodic digest per person.</p>
            <div className="flex items-center gap-3 flex-wrap">
              <div className="flex gap-1 bg-slate-100 rounded-lg p-1 w-fit">
                {[['immediate', 'Immediate'], ['digest', 'Digest']].map(([v, l]) => (
                  <button key={v} onClick={() => saveNotif({ cadence: v })} disabled={notifBusy}
                    className={`px-3 py-1 rounded-md text-xs font-semibold transition-colors disabled:opacity-50 ${notif.cadence === v ? 'bg-white text-[#1F4E79] shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>{l}</button>
                ))}
              </div>
              {notif.cadence === 'digest' && (
                <label className="text-xs text-slate-500 flex items-center gap-2">every
                  <input type="number" min="5" max="240" value={notif.digest_minutes ?? 15}
                    onChange={e => setNotif(n => ({ ...n, digest_minutes: e.target.value }))}
                    onBlur={e => saveNotif({ digest_minutes: e.target.value })}
                    className="w-16 border border-slate-200 rounded-lg px-2 py-1 text-xs focus:outline-none focus:border-[#1F4E79]" /> min
                </label>
              )}
            </div>
          </div>

          {/* Channels */}
          <div className="bg-white border border-slate-200 rounded-xl p-4">
            <p className="text-sm font-semibold text-slate-800 mb-3">Channels</p>
            {[['email_enabled', 'Email', 'Sends via your Resend key even when the app is closed.'], ['push_enabled', 'Browser push', 'Instant desktop notifications while the browser runs (needs a VAPID key below).']].map(([k, label, hint]) => (
              <div key={k} className="flex items-center justify-between gap-4 py-2 border-t border-slate-50 first:border-0">
                <div><p className="text-[13px] text-slate-700">{label}</p><p className="text-[11px] text-slate-400">{hint}</p></div>
                <button role="switch" aria-checked={!!notif[k]} onClick={() => saveNotif({ [k]: !notif[k] })} disabled={notifBusy}
                  className={`relative shrink-0 w-11 h-6 rounded-full transition-colors ${notif[k] ? 'bg-[#1F4E79]' : 'bg-slate-300'} disabled:opacity-50`}>
                  <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${notif[k] ? 'translate-x-5' : ''}`} />
                </button>
              </div>
            ))}
            <div className="mt-3">
              <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">VAPID public key (for push)</label>
              <input value={notif.vapid_public ?? ''} onChange={e => setNotif(n => ({ ...n, vapid_public: e.target.value }))} onBlur={e => saveNotif({ vapid_public: e.target.value })}
                placeholder="Base64 URL-safe public key" className="w-full border border-slate-200 rounded-lg px-3 py-1.5 text-xs font-mono focus:outline-none focus:border-[#1F4E79]" />
            </div>
          </div>

          {/* Delivery schedule */}
          <div className="bg-white border border-slate-200 rounded-xl p-4">
            <p className="text-sm font-semibold text-slate-800 mb-1">Delivery check</p>
            <p className="text-[11px] text-slate-400 mb-3">How often the server scans for unread messages to deliver. Per-person cadence above still applies.</p>
            <div className="flex gap-1 bg-slate-100 rounded-lg p-1 w-fit">
              {[[0, 'Off'], [1, '1 min'], [5, '5 min'], [15, '15 min']].map(([m, l]) => (
                <button key={m} onClick={() => setNotifySchedule(m)} disabled={notifBusy}
                  className="px-3 py-1 rounded-md text-xs font-semibold text-slate-500 hover:text-slate-700 disabled:opacity-50">{l}</button>
              ))}
            </div>
          </div>
        </div>
      ))}

      {/* Edit modal */}
      {editing && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50 p-4" onClick={() => !busy && setEditing(null)}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6" onClick={e => e.stopPropagation()}>
            <h3 className="text-lg font-bold text-slate-800 mb-1">Edit user</h3>
            <p className="text-xs text-slate-400 mb-4">{editing.email}</p>
            <div className="space-y-3">
              <div>
                <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">Full name</label>
                <input value={editForm.full_name} onChange={e => setEditForm(f => ({ ...f, full_name: e.target.value }))}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#1F4E79]" />
              </div>
              <div>
                <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">Persona</label>
                <select value={editForm.role} onChange={e => setEditForm(f => ({ ...f, role: e.target.value }))}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:border-[#1F4E79]">
                  <option value="">— None</option>
                  {allRoles.map(r => <option key={r.code} value={r.code}>{r.label}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">Email</label>
                <input type="email" value={editForm.email} onChange={e => setEditForm(f => ({ ...f, email: e.target.value }))}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#1F4E79]" />
                <p className="text-[10px] text-slate-400 mt-1">Changing email updates their sign-in address.</p>
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-6">
              <button onClick={() => setEditing(null)} disabled={busy} className="text-sm font-semibold text-slate-500 px-4 py-2 rounded-lg hover:bg-slate-100">Cancel</button>
              <button onClick={saveEdit} disabled={busy} className="text-sm font-semibold text-white bg-[#1F4E79] px-4 py-2 rounded-lg hover:bg-[#163a5c] disabled:opacity-60">
                {busy ? 'Saving…' : 'Save changes'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
