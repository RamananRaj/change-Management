import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

// Master Admin oversight hub. Its own sub-navigation keeps future views (users, invites,
// activity, health…) contained here rather than adding tabs to the top Admin bar.
const SUBTABS = ['User Management', 'Pending Invites']

export default function SystemAdmin({ allRoles = [] }) {
  const [tab, setTab]         = useState('User Management')
  const [loading, setLoading] = useState(true)
  const [clients, setClients] = useState([])
  const [users,   setUsers]   = useState([])
  const [invites, setInvites] = useState([])
  const [clientFilter, setClientFilter] = useState('')
  const [search, setSearch]   = useState('')

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    const [{ data: cls }, { data: profs }, { data: pm }, { data: projs }, emailRes, { data: inv }] = await Promise.all([
      supabase.from('clients').select('id, name'),
      supabase.from('profiles').select('id, full_name, role, industry, is_admin, is_client_admin, client_id, onboarding_done, created_at'),
      supabase.from('project_members').select('user_id, project_id'),
      supabase.from('projects').select('id, name, client_id'),
      supabase.rpc('admin_user_emails'),
      supabase.from('project_invites').select('id, email, full_name, role, status, client_id, project_id, as_client_admin, created_at').eq('status', 'pending').order('created_at', { ascending: false }),
    ])
    setClients(cls ?? [])
    const emailOf  = id => (emailRes?.data ?? []).find(e => e.id === id)?.email ?? null
    const projName = id => (projs ?? []).find(p => p.id === id)?.name

    setUsers((profs ?? []).map(p => {
      const projNames = [...new Set((pm ?? []).filter(m => m.user_id === p.id).map(m => projName(m.project_id)).filter(Boolean))]
      const access = p.is_admin ? 'Master Admin' : p.is_client_admin ? 'Client Admin' : 'Member'
      return { id: p.id, name: p.full_name ?? '—', email: emailOf(p.id), role: p.role ?? null,
               client_id: p.client_id ?? null, access, projects: projNames,
               joined: p.created_at ?? null, onboarded: !!p.onboarding_done }
    }).sort((a, b) => (a.name ?? '').localeCompare(b.name ?? '')))

    setInvites((inv ?? []).map(i => ({ ...i, projectName: projName(i.project_id) })))
    setLoading(false)
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
        <h2 className="text-lg font-bold text-slate-800">System Admin</h2>
        <p className="text-xs text-slate-400 mt-0.5">Platform-wide oversight for Master Admins.</p>
      </div>

      {/* Sub-navigation */}
      <div className="flex gap-1 bg-slate-100 rounded-xl p-1 mb-6 w-fit">
        {SUBTABS.map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-4 py-1.5 rounded-lg text-sm font-semibold transition-colors ${tab === t ? 'bg-white text-[#1F4E79] shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>
            {t}{t === 'Pending Invites' && invites.length > 0 ? ` (${invites.length})` : ''}
          </button>
        ))}
      </div>

      {/* ── USER MANAGEMENT ── */}
      {tab === 'User Management' && (
        <div>
          <div className="grid grid-cols-4 gap-3 mb-5">
            {[
              { v: users.length, l: 'Total users' },
              { v: clients.length, l: 'Clients' },
              { v: clientAdmins, l: 'Client admins' },
              { v: unassigned, l: 'Unassigned' },
            ].map((m, i) => (
              <div key={i} className="bg-white rounded-xl border border-slate-100 p-4">
                <p className="text-2xl font-bold text-[#1F4E79]">{m.v}</p>
                <p className="text-[11px] text-slate-400 mt-1 font-medium">{m.l}</p>
              </div>
            ))}
          </div>

          <div className="flex flex-wrap gap-3 mb-4">
            <select value={clientFilter} onChange={e => setClientFilter(e.target.value)}
              className="border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:border-[#1F4E79] min-w-[200px]">
              <option value="">All clients</option>
              {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              <option value="__none">— Unassigned</option>
            </select>
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
                    <th className="py-2.5 px-4">Projects</th><th className="py-2.5 px-4">Joined</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map(u => (
                    <tr key={u.id} className="border-t border-slate-100 hover:bg-slate-50/60">
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
                      <td className="py-2.5 px-4 text-slate-600">{u.client_id ? clientName(u.client_id) : <span className="text-slate-300">—</span>}</td>
                      <td className="py-2.5 px-4"><span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${accessBadge(u.access)}`}>{u.access}</span></td>
                      <td className="py-2.5 px-4 text-slate-600">{roleLabel(u.role)}</td>
                      <td className="py-2.5 px-4">
                        {u.projects.length === 0 ? <span className="text-slate-300">—</span> : (
                          <span className="text-slate-600 text-xs">{u.projects.slice(0, 2).join(', ')}{u.projects.length > 2 ? ` +${u.projects.length - 2}` : ''}</span>
                        )}
                      </td>
                      <td className="py-2.5 px-4 text-slate-500 text-xs whitespace-nowrap">{fmtDate(u.joined)}</td>
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
    </div>
  )
}
