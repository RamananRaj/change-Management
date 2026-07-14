import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../lib/supabase'

// Client Admin landing: a roll-up of THEIR client's programme — projects, team size,
// and how the team is tracking through each project's pathway. Not personal progress.
export default function ClientAdminDashboard() {
  const { profile } = useAuth()
  const [loading, setLoading] = useState(true)
  const [client,  setClient]  = useState(null)
  const [rows,    setRows]    = useState([])
  const [totals,  setTotals]  = useState({ projects: 0, members: 0, pct: 0 })

  const firstName = profile?.full_name ? profile.full_name.split(' ')[0] : 'there'
  const hour = new Date().getHours()
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening'

  useEffect(() => { if (profile?.client_id) load() }, [profile?.client_id])

  async function load() {
    setLoading(true)
    const clientId = profile.client_id
    const { data: cl } = await supabase.from('clients').select('*').eq('id', clientId).single()
    setClient(cl)

    const { data: projects } = await supabase
      .from('projects').select('id, name, description').eq('client_id', clientId)
      .order('created_at', { ascending: false })
    const projIds = (projects ?? []).map(p => p.id)
    if (projIds.length === 0) {
      setRows([]); setTotals({ projects: 0, members: 0, pct: 0 }); setLoading(false); return
    }

    const [{ data: members }, { data: pathways }] = await Promise.all([
      supabase.from('project_members').select('project_id, user_id').in('project_id', projIds),
      supabase.from('project_pathways').select('project_id, content_id').in('project_id', projIds),
    ])
    const allMemberIds = [...new Set((members ?? []).map(m => m.user_id))]
    let acts = []
    if (allMemberIds.length) {
      const { data } = await supabase.from('user_activities')
        .select('user_id, content_id, status').in('user_id', allMemberIds).eq('status', 'completed')
      acts = data ?? []
    }

    const rollup = (projects ?? []).map(p => {
      const memberIds  = [...new Set((members ?? []).filter(m => m.project_id === p.id).map(m => m.user_id))]
      const contentIds = new Set((pathways ?? []).filter(pw => pw.project_id === p.id).map(pw => pw.content_id))
      const steps = contentIds.size
      const total = steps * Math.max(memberIds.length, 1)
      const done  = acts.filter(a => memberIds.includes(a.user_id) && contentIds.has(a.content_id)).length
      const pct   = total > 0 ? Math.round((done / total) * 100) : 0
      return { ...p, members: memberIds.length, steps, done, total, pct }
    })
    setRows(rollup)
    const totDone  = rollup.reduce((s, r) => s + r.done, 0)
    const totTotal = rollup.reduce((s, r) => s + r.total, 0)
    setTotals({
      projects: projIds.length,
      members:  allMemberIds.length,
      pct:      totTotal > 0 ? Math.round((totDone / totTotal) * 100) : 0,
    })
    setLoading(false)
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="bg-[#1F4E79] text-white px-8 py-8">
        <p className="text-xs font-semibold tracking-widest text-white/50 uppercase mb-1">Client Admin</p>
        <h1 className="text-2xl font-bold">{greeting}, {firstName}</h1>
        <p className="text-white/70 text-sm mt-1">
          Programme overview for <strong>{client?.name ?? 'your client'}</strong>
        </p>
      </div>

      <div className="px-8 py-6">
        {/* Metric cards */}
        <div className="grid grid-cols-3 gap-4 mb-8">
          <div className="bg-white rounded-2xl border border-slate-100 p-5">
            <p className="text-2xl font-bold text-[#1F4E79]">{totals.projects}</p>
            <p className="text-xs text-slate-400 mt-1 font-medium">Projects</p>
          </div>
          <div className="bg-white rounded-2xl border border-slate-100 p-5">
            <p className="text-2xl font-bold text-[#1F4E79]">{totals.members}</p>
            <p className="text-xs text-slate-400 mt-1 font-medium">People</p>
          </div>
          <div className="bg-white rounded-2xl border border-slate-100 p-5">
            <p className="text-2xl font-bold text-[#E8913A]">{totals.pct}%</p>
            <p className="text-xs text-slate-400 mt-1 font-medium">Avg pathway completion</p>
          </div>
        </div>

        {/* Per-project roll-up */}
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-bold text-slate-600 uppercase tracking-widest">Projects</h2>
          <Link to="/client-admin" className="text-sm font-semibold text-[#1F4E79] hover:underline">Manage programme →</Link>
        </div>

        {loading ? (
          <div className="space-y-3">{[1,2,3].map(n => <div key={n} className="h-20 bg-slate-100 rounded-xl animate-pulse" />)}</div>
        ) : rows.length === 0 ? (
          <div className="text-center py-12 bg-white rounded-2xl border border-slate-100">
            <p className="text-slate-500 text-sm font-semibold">No projects yet</p>
            <p className="text-slate-400 text-xs mt-1">Create your first project from Manage programme.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {rows.map(r => (
              <Link key={r.id} to="/client-admin"
                className="block bg-white rounded-2xl border border-slate-100 p-5 hover:border-[#1F4E79]/30 transition-colors">
                <div className="flex items-center justify-between mb-2">
                  <div className="min-w-0">
                    <p className="font-semibold text-slate-800 truncate">{r.name}</p>
                    <p className="text-xs text-slate-400 mt-0.5">
                      {r.members} {r.members === 1 ? 'person' : 'people'} · {r.steps} pathway {r.steps === 1 ? 'step' : 'steps'}
                    </p>
                  </div>
                  <span className="text-lg font-bold text-[#1F4E79] shrink-0 ml-4">{r.pct}%</span>
                </div>
                <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                  <div className="h-full bg-[#E8913A] rounded-full" style={{ width: `${r.pct}%` }} />
                </div>
                {r.steps === 0 && (
                  <p className="text-[11px] text-amber-600 mt-2">No pathway set yet — set steps to track progress.</p>
                )}
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
