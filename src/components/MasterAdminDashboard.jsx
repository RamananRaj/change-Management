import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../lib/supabase'

// Master Admin landing: a platform-wide roll-up across every client. Each client card
// collapses to a summary and expands to its per-project pathway progress.
export default function MasterAdminDashboard() {
  const { profile } = useAuth()
  const [loading, setLoading] = useState(true)
  const [rows,    setRows]    = useState([])
  const [totals,  setTotals]  = useState({ clients: 0, projects: 0, members: 0, pct: 0 })
  const [expanded, setExpanded] = useState({})   // { clientId: true }

  const firstName = profile?.full_name ? profile.full_name.split(' ')[0] : 'there'
  const hour = new Date().getHours()
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening'

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    const [{ data: clients }, { data: projects }] = await Promise.all([
      supabase.from('clients').select('id, name, industry').order('name'),
      supabase.from('projects').select('id, name, client_id'),
    ])
    const projIds = (projects ?? []).map(p => p.id)

    let members = [], pathways = [], acts = []
    if (projIds.length) {
      const [{ data: m }, { data: pw }] = await Promise.all([
        supabase.from('project_members').select('project_id, user_id').in('project_id', projIds),
        supabase.from('project_pathways').select('project_id, content_id').in('project_id', projIds),
      ])
      members = m ?? []; pathways = pw ?? []
      const allMemberIds = [...new Set(members.map(x => x.user_id))]
      if (allMemberIds.length) {
        const { data } = await supabase.from('user_activities')
          .select('user_id, content_id, status').in('user_id', allMemberIds).eq('status', 'completed')
        acts = data ?? []
      }
    }

    // Per-project pathway roll-up
    const projRollup = (projects ?? []).map(p => {
      const pMembers   = [...new Set(members.filter(m => m.project_id === p.id).map(m => m.user_id))]
      const contentIds = new Set(pathways.filter(pw => pw.project_id === p.id).map(pw => pw.content_id))
      const steps = contentIds.size
      const total = steps * Math.max(pMembers.length, 1)
      const done  = acts.filter(a => pMembers.includes(a.user_id) && contentIds.has(a.content_id)).length
      return { id: p.id, name: p.name, client_id: p.client_id, members: pMembers.length, steps, done, total,
               pct: total > 0 ? Math.round((done / total) * 100) : 0 }
    })

    // Per-client roll-up (aggregate of its projects)
    const rollup = (clients ?? []).map(c => {
      const cProjects = projRollup.filter(p => p.client_id === c.id)
      const memberIds = [...new Set(members.filter(m => cProjects.some(cp => cp.id === m.project_id)).map(m => m.user_id))]
      const done  = cProjects.reduce((s, p) => s + p.done, 0)
      const total = cProjects.reduce((s, p) => s + p.total, 0)
      return { ...c, projects: cProjects.length, members: memberIds.length,
               pct: total > 0 ? Math.round((done / total) * 100) : 0, projectList: cProjects }
    })
    setRows(rollup)

    const gDone  = projRollup.reduce((s, p) => s + p.done, 0)
    const gTotal = projRollup.reduce((s, p) => s + p.total, 0)
    setTotals({
      clients:  (clients ?? []).length,
      projects: projIds.length,
      members:  [...new Set(members.map(x => x.user_id))].length,
      pct:      gTotal > 0 ? Math.round((gDone / gTotal) * 100) : 0,
    })
    setLoading(false)
  }

  const toggle    = id => setExpanded(prev => ({ ...prev, [id]: !prev[id] }))
  const expandAll = () => setExpanded(Object.fromEntries(rows.map(r => [r.id, true])))
  const collapseAll = () => setExpanded({})
  const anyOpen = Object.values(expanded).some(Boolean)

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="bg-[#1F4E79] text-white px-8 py-8">
        <p className="text-xs font-semibold tracking-widest text-white/50 uppercase mb-1">Platform Admin</p>
        <h1 className="text-2xl font-bold">{greeting}, {firstName}</h1>
        <p className="text-white/70 text-sm mt-1">Platform overview across all clients</p>
      </div>

      <div className="px-8 py-6">
        <div className="grid grid-cols-4 gap-4 mb-8">
          {[
            { v: totals.clients,  l: 'Clients',        c: 'text-[#1F4E79]' },
            { v: totals.projects, l: 'Projects',       c: 'text-[#1F4E79]' },
            { v: totals.members,  l: 'People',         c: 'text-[#1F4E79]' },
            { v: `${totals.pct}%`, l: 'Avg completion', c: 'text-[#E8913A]' },
          ].map((m, i) => (
            <div key={i} className="bg-white rounded-2xl border border-slate-100 p-5">
              <p className={`text-2xl font-bold ${m.c}`}>{m.v}</p>
              <p className="text-xs text-slate-400 mt-1 font-medium">{m.l}</p>
            </div>
          ))}
        </div>

        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-bold text-slate-600 uppercase tracking-widest">Clients</h2>
          <div className="flex items-center gap-4">
            {rows.length > 0 && (
              <button onClick={anyOpen ? collapseAll : expandAll}
                className="text-xs font-semibold text-slate-500 hover:text-[#1F4E79]">
                {anyOpen ? 'Collapse all' : 'Expand all'}
              </button>
            )}
            <Link to="/admin" className="text-sm font-semibold text-[#1F4E79] hover:underline">Open admin →</Link>
          </div>
        </div>

        {loading ? (
          <div className="space-y-3">{[1,2,3].map(n => <div key={n} className="h-20 bg-slate-100 rounded-xl animate-pulse" />)}</div>
        ) : rows.length === 0 ? (
          <div className="text-center py-12 bg-white rounded-2xl border border-slate-100">
            <p className="text-slate-500 text-sm font-semibold">No clients yet</p>
            <p className="text-slate-400 text-xs mt-1">Create your first client from the admin page.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {rows.map(c => {
              const open = !!expanded[c.id]
              return (
                <div key={c.id} className="bg-white rounded-2xl border border-slate-100 overflow-hidden">
                  {/* Client summary row */}
                  <button onClick={() => toggle(c.id)} className="w-full text-left p-5 hover:bg-slate-50/60 transition-colors">
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="text-slate-300 text-sm w-4 shrink-0">{open ? '▾' : '▸'}</span>
                        <div className="min-w-0">
                          <p className="font-semibold text-slate-800 truncate">{c.name}</p>
                          <p className="text-xs text-slate-400 mt-0.5">
                            {c.projects} {c.projects === 1 ? 'project' : 'projects'} · {c.members} {c.members === 1 ? 'person' : 'people'}
                          </p>
                        </div>
                      </div>
                      <span className="text-lg font-bold text-[#1F4E79] shrink-0 ml-4">{c.pct}%</span>
                    </div>
                    <div className="h-2 bg-slate-100 rounded-full overflow-hidden ml-6">
                      <div className="h-full bg-[#E8913A] rounded-full" style={{ width: `${c.pct}%` }} />
                    </div>
                  </button>

                  {/* Expanded: per-project breakdown */}
                  {open && (
                    <div className="px-5 pb-5 pt-1 ml-6 border-t border-slate-50">
                      {c.projectList.length === 0 ? (
                        <p className="text-xs text-slate-400 py-3">No projects yet.</p>
                      ) : (
                        <div className="space-y-3 pt-3">
                          {c.projectList.map(p => (
                            <div key={p.id}>
                              <div className="flex items-center justify-between mb-1">
                                <div className="min-w-0">
                                  <span className="text-sm font-medium text-slate-700">{p.name}</span>
                                  <span className="text-[11px] text-slate-400 ml-2">
                                    {p.members} {p.members === 1 ? 'person' : 'people'} · {p.steps} {p.steps === 1 ? 'step' : 'steps'}
                                  </span>
                                </div>
                                <span className="text-sm font-semibold text-[#1F4E79] shrink-0 ml-4">{p.pct}%</span>
                              </div>
                              <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
                                <div className="h-full bg-[#1F4E79] rounded-full" style={{ width: `${p.pct}%` }} />
                              </div>
                              {p.steps === 0 && <p className="text-[10px] text-amber-600 mt-1">No pathway set yet.</p>}
                            </div>
                          ))}
                        </div>
                      )}
                      <Link to="/admin" className="inline-block mt-3 text-xs font-semibold text-[#1F4E79] hover:underline">
                        Manage {c.name} →
                      </Link>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
