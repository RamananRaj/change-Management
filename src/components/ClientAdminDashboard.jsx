import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../lib/supabase'
import MiniTimeline from './MiniTimeline'

const PHASES = [1, 2, 3, 4, 5]
const PHASE_NAMES = { 1: 'Diagnose', 2: 'Design', 3: 'Engage', 4: 'Embed', 5: 'Evaluate' }

function rag(score) {
  if (score === null || score === undefined) return null
  if (score >= 3.5) return { label: 'On track', dot: '#16a34a', bg: '#dcfce7', text: '#15803d' }
  if (score >= 2.5) return { label: 'At risk',  dot: '#f59e0b', bg: '#fef3c7', text: '#b45309' }
  return { label: 'Critical', dot: '#dc2626', bg: '#fee2e2', text: '#b91c1c' }
}

// Client Admin landing: a roll-up of THEIR client — projects, team progress, timeline,
// needs-attention and upcoming milestones. A cut-down of the platform overview.
export default function ClientAdminDashboard() {
  const { profile } = useAuth()
  const [loading, setLoading] = useState(true)
  const [client,  setClient]  = useState(null)
  const [rows,    setRows]    = useState([])
  const [totals,  setTotals]  = useState({ projects: 0, members: 0, pct: 0, atRisk: 0, rag: null })
  const [needsAttention, setNeedsAttention] = useState([])
  const [upcoming, setUpcoming] = useState([])
  const [expanded, setExpanded] = useState({})

  const toggle      = id => setExpanded(prev => ({ ...prev, [id]: !prev[id] }))
  const expandAll   = () => setExpanded(Object.fromEntries(rows.map(r => [r.id, true])))
  const collapseAll = () => setExpanded({})
  const anyOpen     = Object.values(expanded).some(Boolean)
  const fmtDate = d => new Date(d).toLocaleDateString('en', { day: 'numeric', month: 'short' })

  const firstName = profile?.full_name ? profile.full_name.split(' ')[0] : 'there'
  const hour = new Date().getHours()
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening'

  useEffect(() => { if (profile?.client_id) load() }, [profile?.client_id])

  async function load() {
    setLoading(true)
    const today = new Date()
    const clientId = profile.client_id
    const { data: cl } = await supabase.from('clients').select('*').eq('id', clientId).single()
    setClient(cl)

    const { data: projects } = await supabase
      .from('projects').select('id, name').eq('client_id', clientId).order('created_at', { ascending: false })
    const projIds = (projects ?? []).map(p => p.id)
    if (projIds.length === 0) {
      setRows([]); setNeedsAttention([]); setUpcoming([])
      setTotals({ projects: 0, members: 0, pct: 0, atRisk: 0, rag: null }); setLoading(false); return
    }

    const [{ data: members }, { data: pathways }, { data: phaseRows }, { data: milestones }] = await Promise.all([
      supabase.from('project_members').select('project_id, user_id').in('project_id', projIds),
      supabase.from('project_pathways').select('project_id, phase_number, content_id').in('project_id', projIds),
      supabase.from('project_phases').select('project_id, phase_number, planned_start, planned_end, status').in('project_id', projIds),
      supabase.from('project_milestones').select('project_id, name, milestone_date, color').in('project_id', projIds),
    ])
    const allMemberIds = [...new Set((members ?? []).map(m => m.user_id))]
    let acts = [], profs = [], surveys = []
    if (allMemberIds.length) {
      const [{ data: a }, { data: pr }, { data: s }] = await Promise.all([
        supabase.from('user_activities').select('user_id, content_id, status').in('user_id', allMemberIds).eq('status', 'completed'),
        supabase.from('profiles').select('id, full_name, role').in('id', allMemberIds),
        supabase.from('survey_responses').select('user_id, score, submitted_at').in('user_id', allMemberIds).not('submitted_at', 'is', null),
      ])
      acts = a ?? []; profs = pr ?? []; surveys = s ?? []
    }
    const profOf = id => profs.find(p => p.id === id)

    const rollup = (projects ?? []).map(p => {
      const memberIds  = [...new Set((members ?? []).filter(m => m.project_id === p.id).map(m => m.user_id))]
      const allContent = new Set((pathways ?? []).filter(pw => pw.project_id === p.id).map(pw => pw.content_id))
      const steps = allContent.size
      const total = steps * Math.max(memberIds.length, 1)
      const done  = acts.filter(a => memberIds.includes(a.user_id) && allContent.has(a.content_id)).length
      const phasesOut = PHASES.map(n => {
        const cIds = new Set((pathways ?? []).filter(pw => pw.project_id === p.id && pw.phase_number === n).map(pw => pw.content_id))
        const st = cIds.size, tot = st * Math.max(memberIds.length, 1)
        const dn = acts.filter(a => memberIds.includes(a.user_id) && cIds.has(a.content_id)).length
        const row = (phaseRows ?? []).find(r => r.project_id === p.id && r.phase_number === n)
        return { phase_number: n, name: PHASE_NAMES[n], planned_start: row?.planned_start ?? null,
                 planned_end: row?.planned_end ?? null, status: row?.status ?? 'locked', steps: st,
                 pct: tot > 0 ? Math.round((dn / tot) * 100) : 0 }
      })
      const memberList = memberIds.map(uid => {
        const mdone = acts.filter(a => a.user_id === uid && allContent.has(a.content_id)).length
        const prof = profOf(uid)
        return { id: uid, name: prof?.full_name ?? '—', role: prof?.role ?? '', done: mdone, steps,
                 pct: steps > 0 ? Math.round((mdone / steps) * 100) : 0 }
      }).sort((a, b) => b.pct - a.pct)
      return { ...p, members: memberIds.length, steps, done, total,
               pct: total > 0 ? Math.round((done / total) * 100) : 0,
               phases: phasesOut, milestones: (milestones ?? []).filter(m => m.project_id === p.id), memberList }
    })
    setRows(rollup)

    // Needs attention
    const na = []
    rollup.forEach(p => p.phases.forEach(ph => {
      if (ph.planned_end && new Date(ph.planned_end) < today && ph.pct < 100 && ph.steps > 0) {
        na.push({ phase: ph.name, pct: ph.pct, due: ph.planned_end, project: p.name })
      }
    }))
    setNeedsAttention(na)

    // Upcoming
    const up = [
      ...(milestones ?? []).filter(m => m.milestone_date && new Date(m.milestone_date) >= today)
        .map(m => ({ date: m.milestone_date, label: m.name, project: (projects ?? []).find(x => x.id === m.project_id)?.name, kind: 'milestone', color: m.color })),
      ...rollup.flatMap(p => p.phases.filter(ph => ph.planned_start && new Date(ph.planned_start) > today)
        .map(ph => ({ date: ph.planned_start, label: `${ph.name} starts`, project: p.name, kind: 'phase' }))),
    ].sort((a, b) => new Date(a.date) - new Date(b.date)).slice(0, 6)
    setUpcoming(up)

    const totDone  = rollup.reduce((s, r) => s + r.done, 0)
    const totTotal = rollup.reduce((s, r) => s + r.total, 0)
    const scored = surveys.filter(s => s.score !== null)
    const avg = scored.length ? scored.reduce((s, r) => s + r.score, 0) / scored.length : null
    setTotals({
      projects: projIds.length, members: allMemberIds.length,
      pct: totTotal > 0 ? Math.round((totDone / totTotal) * 100) : 0, atRisk: na.length, rag: rag(avg),
    })
    setLoading(false)
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="bg-[#1F4E79] text-white px-8 py-8">
        <p className="text-xs font-semibold tracking-widest text-white/50 uppercase mb-1">Client Admin</p>
        <h1 className="text-2xl font-bold">{greeting}, {firstName}</h1>
        <p className="text-white/70 text-sm mt-1">Programme overview for <strong>{client?.name ?? 'your client'}</strong></p>
      </div>

      <div className="px-8 py-6">
        {/* Metric cards */}
        <div className="grid grid-cols-4 gap-4 mb-5">
          <div className="bg-white rounded-2xl border border-slate-100 p-5"><p className="text-2xl font-bold text-[#1F4E79]">{totals.projects}</p><p className="text-xs text-slate-400 mt-1 font-medium">Projects</p></div>
          <div className="bg-white rounded-2xl border border-slate-100 p-5"><p className="text-2xl font-bold text-[#1F4E79]">{totals.members}</p><p className="text-xs text-slate-400 mt-1 font-medium">People</p></div>
          <div className="bg-white rounded-2xl border border-slate-100 p-5"><p className="text-2xl font-bold text-[#E8913A]">{totals.pct}%</p><p className="text-xs text-slate-400 mt-1 font-medium">Avg completion</p></div>
          <div className="bg-white rounded-2xl border border-slate-100 p-5"><p className={`text-2xl font-bold ${totals.atRisk > 0 ? 'text-red-600' : 'text-slate-400'}`}>{totals.atRisk}</p><p className="text-xs text-slate-400 mt-1 font-medium">Need attention</p></div>
        </div>

        {/* Needs attention + Upcoming */}
        <div className="grid md:grid-cols-2 gap-4 mb-6">
          <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4">
            <p className="text-[11px] font-bold text-amber-700 uppercase tracking-widest mb-2">Needs attention</p>
            {needsAttention.length === 0 ? (
              <p className="text-sm text-amber-800/70">Everything on track.</p>
            ) : (
              <div className="space-y-1.5">
                {needsAttention.slice(0, 5).map((n, i) => (
                  <p key={i} className="text-sm text-amber-800"><strong>{n.phase}</strong> overdue · {n.pct}% · {n.project}</p>
                ))}
              </div>
            )}
          </div>
          <div className="bg-white rounded-2xl border border-slate-100 p-4">
            <p className="text-[11px] font-bold text-slate-400 uppercase tracking-widest mb-2">Upcoming milestones</p>
            {upcoming.length === 0 ? (
              <p className="text-sm text-slate-400">Nothing scheduled ahead.</p>
            ) : (
              <div className="space-y-1.5">
                {upcoming.map((u, i) => (
                  <div key={i} className="flex items-center gap-2 text-sm text-slate-700">
                    {u.kind === 'milestone'
                      ? <svg width="9" height="9" viewBox="0 0 16 16"><path d="M8 0 l8 8 -8 8 -8 -8 z" fill={u.color || '#1F4E79'} /></svg>
                      : <span className="w-2 h-2 rounded-full bg-slate-300 inline-block" />}
                    <span className="truncate">{u.label} <span className="text-slate-400 text-xs">· {u.project}</span></span>
                    <span className="ml-auto text-xs text-slate-400 shrink-0">{fmtDate(u.date)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Projects */}
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-bold text-slate-600 uppercase tracking-widest">Projects</h2>
          <div className="flex items-center gap-4">
            {rows.length > 0 && (
              <button onClick={anyOpen ? collapseAll : expandAll} className="text-xs font-semibold text-slate-500 hover:text-[#1F4E79]">
                {anyOpen ? 'Collapse all' : 'Expand all'}
              </button>
            )}
            <Link to="/client-admin" className="text-sm font-semibold text-[#1F4E79] hover:underline">Manage programme →</Link>
          </div>
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
            {rows.map(r => {
              const open = !!expanded[r.id]
              return (
                <div key={r.id} className="bg-white rounded-2xl border border-slate-100 overflow-hidden">
                  <button onClick={() => toggle(r.id)} className="w-full text-left p-5 hover:bg-slate-50/60 transition-colors">
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="text-slate-300 text-sm w-4 shrink-0">{open ? '▾' : '▸'}</span>
                        <div className="min-w-0">
                          <p className="font-semibold text-slate-800 truncate">{r.name}</p>
                          <p className="text-xs text-slate-400 mt-0.5">
                            {r.members} {r.members === 1 ? 'person' : 'people'} · {r.steps} pathway {r.steps === 1 ? 'step' : 'steps'}
                          </p>
                        </div>
                      </div>
                      <span className="text-lg font-bold text-[#1F4E79] shrink-0 ml-4">{r.pct}%</span>
                    </div>
                    <div className="h-2 bg-slate-100 rounded-full overflow-hidden ml-6">
                      <div className="h-full bg-[#E8913A] rounded-full" style={{ width: `${r.pct}%` }} />
                    </div>
                  </button>

                  {open && (
                    <div className="px-5 pb-5 pt-1 ml-6 border-t border-slate-50">
                      {/* Timeline */}
                      <div className="pt-3 pb-4">
                        <MiniTimeline phases={r.phases} milestones={r.milestones} />
                      </div>
                      {/* Per-member progress */}
                      {r.steps === 0 ? (
                        <p className="text-[11px] text-amber-600">No pathway set yet — set steps (Pathway tab) to track progress.</p>
                      ) : r.memberList.length === 0 ? (
                        <p className="text-xs text-slate-400">No members assigned yet.</p>
                      ) : (
                        <div className="space-y-3 border-t border-slate-50 pt-3">
                          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Members</p>
                          {r.memberList.map(m => (
                            <div key={m.id}>
                              <div className="flex items-center justify-between mb-1">
                                <div className="min-w-0">
                                  <span className="text-sm font-medium text-slate-700">{m.name}</span>
                                  {m.role && <span className="text-[11px] text-slate-400 ml-1.5">({m.role})</span>}
                                </div>
                                <span className="text-xs font-semibold text-[#1F4E79] shrink-0 ml-4">{m.done}/{m.steps}</span>
                              </div>
                              <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
                                <div className="h-full bg-[#1F4E79] rounded-full" style={{ width: `${m.pct}%` }} />
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                      <Link to="/client-admin" className="inline-block mt-4 text-xs font-semibold text-[#1F4E79] hover:underline">Open project →</Link>
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
