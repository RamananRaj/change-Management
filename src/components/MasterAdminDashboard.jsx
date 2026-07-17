import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../lib/supabase'
import MiniTimeline from './MiniTimeline'
import AiCanvas from './AiCanvas'

const PHASES = [1, 2, 3, 4, 5]
const PHASE_NAMES = { 1: 'Diagnose', 2: 'Design', 3: 'Engage', 4: 'Embed', 5: 'Evaluate' }

function rag(score) {
  if (score === null || score === undefined) return null
  if (score >= 3.5) return { label: 'On track', dot: '#16a34a', bg: '#dcfce7', text: '#15803d' }
  if (score >= 2.5) return { label: 'At risk',  dot: '#f59e0b', bg: '#fef3c7', text: '#b45309' }
  return { label: 'Critical', dot: '#dc2626', bg: '#fee2e2', text: '#b91c1c' }
}

export default function MasterAdminDashboard() {
  const { profile } = useAuth()
  const [loading, setLoading]   = useState(true)
  const [rows, setRows]         = useState([])
  const [totals, setTotals]     = useState({ clients: 0, projects: 0, members: 0, pct: 0, atRisk: 0 })
  const [needsAttention, setNeedsAttention] = useState([])
  const [upcoming, setUpcoming] = useState([])
  const [expanded, setExpanded] = useState({})
  const [view, setView] = useState('dashboard')   // 'dashboard' | 'ai'

  const firstName = profile?.full_name ? profile.full_name.split(' ')[0] : 'there'
  const hour = new Date().getHours()
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening'

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    const today = new Date()
    const [{ data: clients }, { data: projects }] = await Promise.all([
      supabase.from('clients').select('id, name, industry').order('name'),
      supabase.from('projects').select('id, name, client_id'),
    ])
    const projIds = (projects ?? []).map(p => p.id)

    let members = [], pathways = [], phaseRows = [], milestones = [], acts = [], surveys = []
    if (projIds.length) {
      const [{ data: m }, { data: pw }, { data: ph }, { data: ms }] = await Promise.all([
        supabase.from('project_members').select('project_id, user_id').in('project_id', projIds),
        supabase.from('project_pathways').select('project_id, phase_number, content_id').in('project_id', projIds),
        supabase.from('project_phases').select('project_id, phase_number, planned_start, planned_end, status').in('project_id', projIds),
        supabase.from('project_milestones').select('project_id, name, milestone_date, color').in('project_id', projIds),
      ])
      members = m ?? []; pathways = pw ?? []; phaseRows = ph ?? []; milestones = ms ?? []
      const allMemberIds = [...new Set(members.map(x => x.user_id))]
      if (allMemberIds.length) {
        const [{ data: a }, { data: s }] = await Promise.all([
          supabase.from('user_activities').select('user_id, content_id, status').in('user_id', allMemberIds).eq('status', 'completed'),
          supabase.from('survey_responses').select('user_id, score, submitted_at').in('user_id', allMemberIds).not('submitted_at', 'is', null),
        ])
        acts = a ?? []; surveys = s ?? []
      }
    }

    const projName = id => (projects ?? []).find(p => p.id === id)?.name ?? 'Project'
    const clientName = id => (clients ?? []).find(c => c.id === id)?.name ?? ''

    // Rich per-project object
    const projRollup = (projects ?? []).map(p => {
      const pMembers = [...new Set(members.filter(m => m.project_id === p.id).map(m => m.user_id))]
      const phasesOut = PHASES.map(n => {
        const cIds = new Set(pathways.filter(pw => pw.project_id === p.id && pw.phase_number === n).map(pw => pw.content_id))
        const steps = cIds.size
        const total = steps * Math.max(pMembers.length, 1)
        const done  = acts.filter(a => pMembers.includes(a.user_id) && cIds.has(a.content_id)).length
        const row   = phaseRows.find(r => r.project_id === p.id && r.phase_number === n)
        return { phase_number: n, name: PHASE_NAMES[n], planned_start: row?.planned_start ?? null,
                 planned_end: row?.planned_end ?? null, status: row?.status ?? 'locked', steps, done, total,
                 pct: total > 0 ? Math.round((done / total) * 100) : 0 }
      })
      const done  = phasesOut.reduce((s, x) => s + x.done, 0)
      const total = phasesOut.reduce((s, x) => s + x.total, 0)
      const mls   = milestones.filter(m => m.project_id === p.id)
      return { id: p.id, name: p.name, client_id: p.client_id, members: pMembers.length,
               pct: total > 0 ? Math.round((done / total) * 100) : 0, phases: phasesOut, milestones: mls, done, total }
    })

    // Needs attention: any phase past its end date but under 100%
    const na = []
    projRollup.forEach(p => p.phases.forEach(ph => {
      if (ph.planned_end && new Date(ph.planned_end) < today && ph.pct < 100 && ph.steps > 0) {
        na.push({ phase: ph.name, pct: ph.pct, due: ph.planned_end, project: p.name, client: clientName(p.client_id) })
      }
    }))
    setNeedsAttention(na)

    // Upcoming: milestones + phase starts still ahead
    const up = [
      ...milestones.filter(m => m.milestone_date && new Date(m.milestone_date) >= today)
        .map(m => ({ date: m.milestone_date, label: m.name, project: projName(m.project_id), kind: 'milestone', color: m.color })),
      ...projRollup.flatMap(p => p.phases.filter(ph => ph.planned_start && new Date(ph.planned_start) > today)
        .map(ph => ({ date: ph.planned_start, label: `${ph.name} starts`, project: p.name, kind: 'phase' }))),
    ].sort((a, b) => new Date(a.date) - new Date(b.date)).slice(0, 6)
    setUpcoming(up)

    // Per-client roll-up + RAG
    const rollup = (clients ?? []).map(c => {
      const cProjects = projRollup.filter(p => p.client_id === c.id)
      const memberIds = [...new Set(members.filter(m => cProjects.some(cp => cp.id === m.project_id)).map(m => m.user_id))]
      const done  = cProjects.reduce((s, p) => s + p.done, 0)
      const total = cProjects.reduce((s, p) => s + p.total, 0)
      const cScores = surveys.filter(s => memberIds.includes(s.user_id) && s.score !== null)
      const avg = cScores.length ? cScores.reduce((s, r) => s + r.score, 0) / cScores.length : null
      return { ...c, projects: cProjects.length, members: memberIds.length,
               pct: total > 0 ? Math.round((done / total) * 100) : 0, rag: rag(avg), projectList: cProjects }
    })
    setRows(rollup)

    const gDone  = projRollup.reduce((s, p) => s + p.done, 0)
    const gTotal = projRollup.reduce((s, p) => s + p.total, 0)
    setTotals({
      clients: (clients ?? []).length, projects: projIds.length,
      members: [...new Set(members.map(x => x.user_id))].length,
      pct: gTotal > 0 ? Math.round((gDone / gTotal) * 100) : 0, atRisk: na.length,
    })
    setLoading(false)
  }

  const toggle      = id => setExpanded(prev => ({ ...prev, [id]: !prev[id] }))
  const expandAll   = () => setExpanded(Object.fromEntries(rows.map(r => [r.id, true])))
  const collapseAll = () => setExpanded({})
  const anyOpen     = Object.values(expanded).some(Boolean)
  const fmtDate = d => new Date(d).toLocaleDateString('en', { day: 'numeric', month: 'short' })

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="bg-[#1F4E79] text-white px-8 py-8">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold tracking-widest text-white/50 uppercase mb-1">Platform Admin</p>
            <h1 className="text-2xl font-bold">{greeting}, {firstName}</h1>
            <p className="text-white/70 text-sm mt-1">{view === 'ai' ? 'Ask AI across all clients — grounded in your data' : 'Platform overview across all clients'}</p>
          </div>
          {/* Dashboard ⇄ AI toggle. Dashboard is the default; nothing is removed. */}
          <div className="flex bg-white/10 rounded-xl p-1 shrink-0">
            {['dashboard', 'ai'].map(v => (
              <button key={v} onClick={() => setView(v)}
                className={`px-4 py-1.5 rounded-lg text-sm font-semibold transition-colors ${view === v ? 'bg-white text-[#1F4E79] shadow-sm' : 'text-white/70 hover:text-white'}`}>
                {v === 'dashboard' ? 'Dashboard' : '✦ AI'}
              </button>
            ))}
          </div>
        </div>
      </div>

      {view === 'ai' ? (
        <div className="px-8 py-6">
          <AiCanvas
            context="Platform overview across all clients"
            initialQueries={['What needs attention?', 'Upcoming milestones']}
            chips={[
              { color: '#1F4E79', tag: 'CLIENTS', label: 'Clients', value: totals.clients, query: 'Show all clients' },
              { color: '#1F4E79', tag: 'PROJECTS', label: 'Projects', value: totals.projects, query: 'Progress by project' },
              { color: '#1F4E79', tag: 'PEOPLE', label: 'People', value: totals.members },
              { color: '#E8913A', tag: 'PROGRESS', label: 'Avg completion', value: `${totals.pct}%`, query: 'Progress by project' },
              { color: totals.atRisk > 0 ? '#DC2626' : '#16A34A', tag: 'ATTENTION', label: 'Need attention', value: totals.atRisk, query: "What's at risk this week?" },
            ]}
          />
        </div>
      ) : (
      <div className="px-8 py-6">
        {/* Metric cards */}
        <div className="grid grid-cols-5 gap-3 mb-5">
          {[
            { v: totals.clients, l: 'Clients', c: 'text-[#1F4E79]' },
            { v: totals.projects, l: 'Projects', c: 'text-[#1F4E79]' },
            { v: totals.members, l: 'People', c: 'text-[#1F4E79]' },
            { v: `${totals.pct}%`, l: 'Avg completion', c: 'text-[#E8913A]' },
            { v: totals.atRisk, l: 'Need attention', c: totals.atRisk > 0 ? 'text-red-600' : 'text-slate-400' },
          ].map((m, i) => (
            <div key={i} className="bg-white rounded-2xl border border-slate-100 p-4">
              <p className={`text-2xl font-bold ${m.c}`}>{m.v}</p>
              <p className="text-[11px] text-slate-400 mt-1 font-medium">{m.l}</p>
            </div>
          ))}
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
                  <p key={i} className="text-sm text-amber-800">
                    <strong>{n.phase}</strong> overdue · {n.pct}% · {n.project} <span className="text-amber-600">· {n.client}</span>
                  </p>
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

        {/* Clients */}
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-bold text-slate-600 uppercase tracking-widest">Clients</h2>
          <div className="flex items-center gap-4">
            {rows.length > 0 && (
              <button onClick={anyOpen ? collapseAll : expandAll} className="text-xs font-semibold text-slate-500 hover:text-[#1F4E79]">
                {anyOpen ? 'Collapse all' : 'Expand all'}
              </button>
            )}
            <Link to="/admin/preview" className="text-sm font-semibold text-[#1F4E79] hover:underline">View as member →</Link>
            <Link to="/admin?section=Clients" className="text-sm font-semibold text-[#1F4E79] hover:underline">Open admin →</Link>
          </div>
        </div>

        {loading ? (
          <div className="space-y-3">{[1,2,3].map(n => <div key={n} className="h-20 bg-slate-100 rounded-xl animate-pulse" />)}</div>
        ) : rows.length === 0 ? (
          <div className="text-center py-12 bg-white rounded-2xl border border-slate-100">
            <p className="text-slate-500 text-sm font-semibold">No clients yet</p>
          </div>
        ) : (
          <div className="space-y-3">
            {rows.map(c => {
              const open = !!expanded[c.id]
              return (
                <div key={c.id} className="bg-white rounded-2xl border border-slate-100 overflow-hidden">
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
                        {c.rag && (
                          <span className="ml-2 inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full shrink-0"
                            style={{ background: c.rag.bg, color: c.rag.text }}>
                            <span className="w-1.5 h-1.5 rounded-full" style={{ background: c.rag.dot }} />{c.rag.label}
                          </span>
                        )}
                      </div>
                      <span className="text-lg font-bold text-[#1F4E79] shrink-0 ml-4">{c.pct}%</span>
                    </div>
                    <div className="h-2 bg-slate-100 rounded-full overflow-hidden ml-6">
                      <div className="h-full bg-[#E8913A] rounded-full" style={{ width: `${c.pct}%` }} />
                    </div>
                  </button>

                  {open && (
                    <div className="px-5 pb-5 pt-1 ml-6 border-t border-slate-50">
                      {c.projectList.length === 0 ? (
                        <p className="text-xs text-slate-400 py-3">No projects yet.</p>
                      ) : (
                        <div className="space-y-5 pt-3">
                          {c.projectList.map(p => (
                            <div key={p.id}>
                              <div className="flex items-center justify-between mb-1">
                                <span className="text-sm font-medium text-slate-700">{p.name}
                                  <span className="text-[11px] text-slate-400 ml-2">{p.members} {p.members === 1 ? 'person' : 'people'}</span>
                                </span>
                                <span className="text-sm font-semibold text-[#1F4E79] shrink-0 ml-4">{p.pct}%</span>
                              </div>
                              <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden mb-3">
                                <div className="h-full bg-[#1F4E79] rounded-full" style={{ width: `${p.pct}%` }} />
                              </div>
                              <MiniTimeline phases={p.phases} milestones={p.milestones} />
                            </div>
                          ))}
                        </div>
                      )}
                      <Link to={`/admin?section=Clients&client=${c.id}`} className="inline-block mt-4 text-xs font-semibold text-[#1F4E79] hover:underline">
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
      )}
    </div>
  )
}
