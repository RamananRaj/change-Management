import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

// Master Admin oversight hub. Its own sub-navigation keeps future views (users, invites,
// activity, health…) contained here rather than adding tabs to the top Admin bar.
// clientId set → scoped mode for a Client Admin (their client's users only).
export default function SystemAdmin({ allRoles = [], clientId = null }) {
  const scoped = !!clientId
  const subtabs = scoped ? ['User Management', 'Pending Invites'] : ['User Management', 'Pending Invites', 'System Health']
  const [tab, setTab]         = useState('User Management')
  const [loading, setLoading] = useState(true)
  const [clients, setClients] = useState([])
  const [users,   setUsers]   = useState([])
  const [invites, setInvites] = useState([])
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
    const ok = await runAction({ action: 'update', userId: editing.id, full_name: editForm.full_name, role: editForm.role || null, email: editForm.email || undefined })
    if (ok) setEditing(null)
  }
  const doReset  = u => runAction({ action: 'reset', userId: u.id, email: u.email, redirectTo: `${window.location.origin}/auth/reset` }, `Send a password reset link to ${u.email}?`)
  const doLock   = u => runAction({ action: u.locked ? 'unlock' : 'lock', userId: u.id }, `${u.locked ? 'Unlock' : 'Lock'} ${u.name}?`)
  const doDelete = u => runAction({ action: 'delete', userId: u.id }, `Permanently delete ${u.name}? This removes their account and cannot be undone.`)

  // ── System Health ──────────────────────────────────────────────────────────
  const [health, setHealth] = useState({ ran: false, running: false, checks: [], dbPing: null, at: null })
  const [healthHistory, setHealthHistory] = useState([])

  async function loadHealthHistory() {
    const { data } = await supabase.from('health_runs').select('*').order('ran_at', { ascending: false }).limit(20)
    setHealthHistory(data ?? [])
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
    for (const t of ['clients', 'projects', 'project_phases', 'project_pathways', 'project_milestones', 'project_members', 'phase_content', 'surveys', 'stakeholders', 'industries', 'roles', 'user_activities', 'project_invites'])
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

  const clientName = id => clients.find(c => c.id === id)?.name ?? '—'
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
          <button key={t} onClick={() => { setTab(t); if (t === 'System Health') { loadHealthHistory(); if (!health.ran) runHealth() } }}
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
            <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-slate-50 text-left text-[11px] font-semibold text-slate-400 uppercase tracking-wide">
                    <th className="py-2.5 px-4">User</th><th className="py-2.5 px-4">Client</th>
                    <th className="py-2.5 px-4">Access</th><th className="py-2.5 px-4">Persona</th>
                    <th className="py-2.5 px-4">Projects</th><th className="py-2.5 px-4">Last sign-in</th>
                    <th className="py-2.5 px-4 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map(u => (
                    <tr key={u.id} className="border-t border-slate-100 hover:bg-slate-50/60 [&>td]:align-middle">
                      <td className="py-2.5 px-4">
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
                      <td className="py-2.5 px-4 text-slate-600 whitespace-nowrap">{u.client_id ? clientName(u.client_id) : <span className="text-slate-300">—</span>}</td>
                      <td className="py-2.5 px-4 whitespace-nowrap">
                        <span className={`inline-block text-[10px] font-semibold px-2 py-0.5 rounded-full whitespace-nowrap ${accessBadge(u.access)}`}>{u.access}</span>
                        {u.locked && <span className="ml-1 inline-block text-[10px] font-semibold px-2 py-0.5 rounded-full bg-red-100 text-red-700 whitespace-nowrap">Locked</span>}
                      </td>
                      <td className="py-2.5 px-4 text-slate-600 whitespace-nowrap">{roleLabel(u.role)}</td>
                      <td className="py-2.5 px-4">
                        {u.projects.length === 0 ? <span className="text-slate-300">—</span> : (
                          <span className="text-slate-600 text-xs">{u.projects.slice(0, 2).join(', ')}{u.projects.length > 2 ? ` +${u.projects.length - 2}` : ''}</span>
                        )}
                      </td>
                      <td className="py-2.5 px-4 text-slate-500 text-xs whitespace-nowrap">{u.lastSignIn ? fmtDate(u.lastSignIn) : <span className="text-slate-300">never</span>}</td>
                      <td className="py-2.5 px-4">
                        <div className="flex items-center justify-end gap-1.5">
                          <button onClick={() => openEdit(u)} disabled={busy} title="Edit"
                            className="text-xs text-[#1F4E79] hover:underline disabled:opacity-40">Edit</button>
                          <span className="text-slate-200">·</span>
                          <button onClick={() => doReset(u)} disabled={busy || !u.email} title="Send reset link"
                            className="text-xs text-slate-500 hover:text-[#1F4E79] disabled:opacity-40">Reset</button>
                          <span className="text-slate-200">·</span>
                          <button onClick={() => doLock(u)} disabled={busy} title={u.locked ? 'Unlock' : 'Lock'}
                            className="text-xs text-slate-500 hover:text-amber-600 disabled:opacity-40">{u.locked ? 'Unlock' : 'Lock'}</button>
                          <span className="text-slate-200">·</span>
                          <button onClick={() => doDelete(u)} disabled={busy} title="Delete"
                            className="text-xs text-red-400 hover:text-red-600 disabled:opacity-40">Delete</button>
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
                  <th className="py-2.5 px-4">Email</th><th className="py-2.5 px-4">Client</th>
                  <th className="py-2.5 px-4">Project</th><th className="py-2.5 px-4">Persona</th>
                  <th className="py-2.5 px-4">As admin</th><th className="py-2.5 px-4">Invited</th>
                </tr>
              </thead>
              <tbody>
                {invites.map(i => (
                  <tr key={i.id} className="border-t border-slate-100 hover:bg-slate-50/60">
                    <td className="py-2.5 px-4">
                      <p className="font-medium text-slate-800">{i.email}</p>
                      {i.full_name && <p className="text-[11px] text-slate-400">{i.full_name}</p>}
                    </td>
                    <td className="py-2.5 px-4 text-slate-600">{clientName(i.client_id)}</td>
                    <td className="py-2.5 px-4 text-slate-600">{i.projectName ?? '—'}</td>
                    <td className="py-2.5 px-4 text-slate-600">{roleLabel(i.role)}</td>
                    <td className="py-2.5 px-4">{i.as_client_admin
                      ? <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-[#1F4E79]/10 text-[#1F4E79]">Client Admin</span>
                      : <span className="text-slate-300">—</span>}</td>
                    <td className="py-2.5 px-4 text-slate-500 text-xs whitespace-nowrap">{fmtDate(i.created_at)}</td>
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
                <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-slate-50 text-left text-[11px] font-semibold text-slate-400 uppercase tracking-wide">
                        <th className="py-2 px-4">Time</th><th className="py-2 px-4">Source</th>
                        <th className="py-2 px-4">Passed</th><th className="py-2 px-4">Failed</th><th className="py-2 px-4">Pass rate</th>
                      </tr>
                    </thead>
                    <tbody>
                      {healthHistory.map(r => (
                        <tr key={r.id} className="border-t border-slate-100">
                          <td className="py-2 px-4 text-slate-600 text-xs whitespace-nowrap">{new Date(r.ran_at).toLocaleString('en', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}</td>
                          <td className="py-2 px-4">
                            <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${r.source === 'scheduled' ? 'bg-amber-100 text-amber-700' : 'bg-slate-100 text-slate-500'}`}>{r.source}</span>
                          </td>
                          <td className="py-2 px-4 text-green-600 font-medium">{r.passed}</td>
                          <td className={`py-2 px-4 font-medium ${r.failed > 0 ? 'text-red-600' : 'text-slate-300'}`}>{r.failed}</td>
                          <td className="py-2 px-4">
                            <span className={`text-xs font-semibold ${rate(r) === 100 ? 'text-green-600' : 'text-[#E8913A]'}`}>{rate(r)}%</span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )
          })()}
        </div>
      )}

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
