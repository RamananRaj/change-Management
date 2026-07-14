import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../lib/supabase'

// Master Admin landing: a platform-wide roll-up across every client — how many clients,
// projects and people, and how each client is tracking through its pathways.
export default function MasterAdminDashboard() {
  const { profile } = useAuth()
  const [loading, setLoading] = useState(true)
  const [rows,    setRows]    = useState([])
  const [totals,  setTotals]  = useState({ clients: 0, projects: 0, members: 0, pct: 0 })

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

    // Aggregate per client across its projects
    const rollup = (clients ?? []).map(c => {
      const cProjIds = (projects ?? []).filter(p => p.client_id === c.id).map(p => p.id)
      const memberIds = [...new Set(members.filter(m => cProjIds.includes(m.project_id)).map(m => m.user_id))]
      let done = 0, total = 0
      cProjIds.forEach(pid => {
        const pMembers  = [...new Set(members.filter(m => m.project_id === pid).map(m => m.user_id))]
        const contentIds = new Set(pathways.filter(pw => pw.project_id === pid).map(pw => pw.content_id))
        total += contentIds.size * Math.max(pMembers.length, 1)
        done  += acts.filter(a => pMembers.includes(a.user_id) && contentIds.has(a.content_id)).length
      })
      const pct = total > 0 ? Math.round((done / total) * 100) : 0
      return { ...c, projects: cProjIds.length, members: memberIds.length, pct }
    })
    setRows(rollup)

    const allMemberIds = [...new Set(members.map(x => x.user_id))]
    let gDone = 0, gTotal = 0
    projIds.forEach(pid => {
      const pMembers  = [...new Set(members.filter(m => m.project_id === pid).map(m => m.user_id))]
      const contentIds = new Set(pathways.filter(pw => pw.project_id === pid).map(pw => pw.content_id))
      gTotal += contentIds.size * Math.max(pMembers.length, 1)
      gDone  += acts.filter(a => pMembers.includes(a.user_id) && contentIds.has(a.content_id)).length
    })
    setTotals({
      clients:  (clients ?? []).length,
      projects: projIds.length,
      members:  allMemberIds.length,
      pct:      gTotal > 0 ? Math.round((gDone / gTotal) * 100) : 0,
    })
    setLoading(false)
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="bg-[#1F4E79] text-white px-8 py-8">
        <p className="text-xs font-semibold tracking-widest text-white/50 uppercase mb-1">Platform Admin</p>
        <h1 className="text-2xl font-bold">{greeting}, {firstName}</h1>
        <p className="text-white/70 text-sm mt-1">Platform overview across all clients</p>
      </div>

      <div className="px-8 py-6">
        <div className="grid grid-cols-4 gap-4 mb-8">
          <div className="bg-white rounded-2xl border border-slate-100 p-5">
            <p className="text-2xl font-bold text-[#1F4E79]">{totals.clients}</p>
            <p className="text-xs text-slate-400 mt-1 font-medium">Clients</p>
          </div>
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
            <p className="text-xs text-slate-400 mt-1 font-medium">Avg completion</p>
          </div>
        </div>

        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-bold text-slate-600 uppercase tracking-widest">Clients</h2>
          <Link to="/admin" className="text-sm font-semibold text-[#1F4E79] hover:underline">Open admin →</Link>
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
            {rows.map(c => (
              <Link key={c.id} to="/admin"
                className="block bg-white rounded-2xl border border-slate-100 p-5 hover:border-[#1F4E79]/30 transition-colors">
                <div className="flex items-center justify-between mb-2">
                  <div className="min-w-0">
                    <p className="font-semibold text-slate-800 truncate">{c.name}</p>
                    <p className="text-xs text-slate-400 mt-0.5">
                      {c.projects} {c.projects === 1 ? 'project' : 'projects'} · {c.members} {c.members === 1 ? 'person' : 'people'}
                    </p>
                  </div>
                  <span className="text-lg font-bold text-[#1F4E79] shrink-0 ml-4">{c.pct}%</span>
                </div>
                <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                  <div className="h-full bg-[#E8913A] rounded-full" style={{ width: `${c.pct}%` }} />
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
