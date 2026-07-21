import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../lib/supabase'
import ClientAdminDashboard from '../components/ClientAdminDashboard'
import MasterAdminDashboard from '../components/MasterAdminDashboard'
import MiniTimeline from '../components/MiniTimeline'
import AiCanvas from '../components/AiCanvas'

// Role-aware dashboard: Master Admin → platform overview, Client Admin → client roll-up,
// everyone else → their personal journey.
export default function Dashboard() {
  const { profile } = useAuth()
  if (profile?.is_admin)        return <MasterAdminDashboard />
  if (profile?.is_client_admin) return <ClientAdminDashboard />
  return <MemberDashboard />
}

const phaseConfig = [
  { num: 1, label: '01', name: 'Diagnose',  path: '/phases/diagnose', icon: '🔍', desc: 'Understand where you are before you move' },
  { num: 2, label: '02', name: 'Design',    path: '/phases/design',   icon: '📐', desc: 'Build the blueprint for successful change' },
  { num: 3, label: '03', name: 'Engage',    path: '/phases/engage',   icon: '🤝', desc: 'Bring people with you, not behind you' },
  { num: 4, label: '04', name: 'Embed',     path: '/phases/embed',    icon: '🔧', desc: 'Make the change stick' },
  { num: 5, label: '05', name: 'Evaluate',  path: '/phases/evaluate', icon: '📊', desc: 'Know what worked — and build on it' },
]

const roleLabels = {
  po: 'Product Owner', cm: 'Change Manager', pm: 'Project Manager',
}

const industryLabels = {
  'financial-services': 'Financial Services',
  'healthcare':         'Healthcare',
  'utilities-energy':   'Utilities & Energy',
  'telecommunications': 'Telecommunications',
  'manufacturing':      'Manufacturing',
  'public-sector':      'Public Sector',
  'retail-consumer':    'Retail & Consumer',
}

function getRag(score, green = 3.5, amber = 2.5) {
  if (score === null || score === undefined) return null
  if (score >= green) return 'green'
  if (score >= amber) return 'amber'
  return 'red'
}

function RagPill({ score, green, amber }) {
  const rag = getRag(score, green, amber)
  if (!rag) return null
  const cfg = {
    green: { label: 'On Track',  bg: 'bg-green-100', text: 'text-green-700', dot: 'bg-green-500' },
    amber: { label: 'At Risk',   bg: 'bg-amber-100',  text: 'text-amber-700',  dot: 'bg-amber-500' },
    red:   { label: 'Critical',  bg: 'bg-red-100',    text: 'text-red-700',    dot: 'bg-red-500'   },
  }[rag]
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold ${cfg.bg} ${cfg.text}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${cfg.dot}`} />
      {cfg.label}
    </span>
  )
}

// Non-navigating stand-in for <Link> used in preview mode (Master Admin looking at
// someone else's dashboard shouldn't be able to click through into live phase pages).
function PreviewNav({ children, className }) { return <span className={className}>{children}</span> }

// `preview` (optional): { userId, profile, projectId } — render this dashboard AS that
// identity, read-only. userId null = persona preview (no real activities). When absent,
// behaves as the signed-in member's own dashboard.
export function MemberDashboard({ preview = null }) {
  const auth = useAuth()
  const profile = preview?.profile ?? auth.profile
  const userId  = preview ? (preview.userId ?? null) : (auth.user?.id ?? null)
  const Nav     = preview ? PreviewNav : Link

  const [phases,         setPhases]         = useState([])
  const [phaseStats,     setPhaseStats]     = useState({})
  const [surveyResults,  setSurveyResults]  = useState([])   // submitted survey responses
  const [templateCount,  setTemplateCount]  = useState(0)    // templates started by user
  const [loading,        setLoading]        = useState(true)
  const [projectsList,   setProjectsList]   = useState([])   // projects the user belongs to
  const [activeProjectId, setActiveProjectId] = useState('')
  const [milestones,     setMilestones]     = useState([])   // project_milestones for the active project

  const firstName = profile?.full_name ? profile.full_name.split(' ')[0] : 'back'
  const hour      = new Date().getHours()
  const greeting  = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening'

  useEffect(() => {
    if (preview) { if (preview.projectId) load(); return }
    if (!auth.user || !profile) return
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, profile, preview?.projectId])

  async function load() {
    try {
      setLoading(true)

      let phaseProjectId = null
      if (preview) {
        // Locked to the previewed project
        phaseProjectId = preview.projectId
        const { data: pr } = await supabase.from('projects').select('id, name').eq('id', phaseProjectId).maybeSingle()
        setProjectsList(pr ? [pr] : [])
        setActiveProjectId(phaseProjectId ?? '')
      } else {
        // 1. Fetch the user's assigned project(s) + active project
        const { data: memberships } = await supabase
          .from('project_members').select('project_id').eq('user_id', userId)
        const memberProjectIds = [...new Set((memberships ?? []).map(m => m.project_id))]
        let projList = []
        if (memberProjectIds.length) {
          const { data: projRows } = await supabase.from('projects').select('id, name').in('id', memberProjectIds)
          projList = projRows ?? []
        }
        setProjectsList(projList)

        let activeId = ''
        if (projList.length) {
          const stored = localStorage.getItem('cf_active_project')
          activeId = projList.some(p => p.id === stored) ? stored : projList[0].id
          setActiveProjectId(activeId)
          localStorage.setItem('cf_active_project', activeId)
        }

        // Phase access: active assigned project, else fall back to personal onboarding project
        phaseProjectId = activeId
        if (!phaseProjectId) {
          const { data: proj } = await supabase
            .from('projects').select('id').eq('user_id', userId)
            .order('created_at', { ascending: false }).limit(1).maybeSingle()
          phaseProjectId = proj?.id ?? null
        }
      }
      if (!phaseProjectId) { setLoading(false); return }

      // Persona preview (no real user) has no activities/responses — skip those queries.
      const actsQ   = userId ? supabase.from('user_activities').select('content_id, phase_number').eq('user_id', userId).eq('status', 'completed') : Promise.resolve({ data: [] })
      const surveyQ = userId ? supabase.from('survey_responses').select('survey_id, score, submitted_at').eq('user_id', userId).not('submitted_at', 'is', null) : Promise.resolve({ data: [] })
      const tmplQ   = userId ? supabase.from('template_responses').select('id').eq('user_id', userId) : Promise.resolve({ data: [] })

      const [
        { data: phaseRows },
        { data: contentItems },
        { data: completedActs },
        { data: surveyResps },
        { data: tmplResps },
        { data: msRows },
      ] = await Promise.all([
        supabase.from('project_phases').select('*').eq('project_id', phaseProjectId).order('phase_number'),
        // Scope "items" to THIS project's pathway steps, not the whole content library.
        supabase.from('project_pathways').select('content_id, phase_number').eq('project_id', phaseProjectId),
        actsQ,
        surveyQ,
        tmplQ,
        supabase.from('project_milestones').select('name, milestone_date, color, lane').eq('project_id', phaseProjectId),
      ])

      setPhases(phaseRows ?? [])
      setMilestones(msRows ?? [])

      // Per-phase content stats, scoped to the project's pathway items only
      const pathIds = new Set((contentItems ?? []).map(c => c.content_id))
      const stats = {}
      for (const cfg of phaseConfig) {
        stats[cfg.num] = {
          available: (contentItems ?? []).filter(c => c.phase_number === cfg.num).length,
          completed: (completedActs ?? []).filter(a => a.phase_number === cfg.num && pathIds.has(a.content_id)).length,
        }
      }
      setPhaseStats(stats)

      // Fetch survey metadata separately (no join, avoids relational query issues)
      const surveyIds = (surveyResps ?? []).map(r => r.survey_id).filter(Boolean)
      let surveyMeta = []
      if (surveyIds.length > 0) {
        const { data: sm } = await supabase
          .from('surveys')
          .select('id, title, phase_number, rag_green_threshold, rag_amber_threshold')
          .in('id', surveyIds)
        surveyMeta = sm ?? []
      }

      const merged = (surveyResps ?? []).map(r => ({
        ...r,
        survey: surveyMeta.find(s => s.id === r.survey_id) ?? null,
      }))
      setSurveyResults(merged)
      setTemplateCount((tmplResps ?? []).length)
    } catch (err) {
      console.error('Dashboard load error:', err)
    } finally {
      setLoading(false)
    }
  }

  // Switch active project — reloads phase access (phase progress is project-independent)
  async function switchProject(pid) {
    setActiveProjectId(pid)
    localStorage.setItem('cf_active_project', pid)
    const { data: phaseRows } = await supabase
      .from('project_phases').select('*').eq('project_id', pid).order('phase_number')
    setPhases(phaseRows ?? [])
  }

  // ── Which phases is this client actually running? ───────────────────────────
  // Lane membership IS scope. A phase in no lane is a later programme, not work that
  // is behind. Showing it here as "locked" tells the client they have something left
  // to do that nobody has asked of them.
  //
  // A project whose phases have never been saved has not chosen a scope yet, so all
  // five apply — same rule as the admin card and the timeline.
  const scopeChosen  = phases.some(p => p.id)
  const scopedNums   = scopeChosen
    ? new Set(phases.filter(p => p.lane_id).map(p => p.phase_number))
    : new Set(phaseConfig.map(c => c.num))
  const scopedConfig = phaseConfig.filter(c => scopedNums.has(c.num))

  // Progress calculations — over the phases in scope only, so the denominator matches
  // what the client was actually asked to do.
  const totalAvailable = Object.entries(phaseStats)
    .filter(([n]) => scopedNums.has(Number(n)))
    .reduce((s, [, p]) => s + p.available, 0)
  const totalCompleted = Object.entries(phaseStats)
    .filter(([n]) => scopedNums.has(Number(n)))
    .reduce((s, [, p]) => s + p.completed, 0)
  const progressPct    = totalAvailable > 0 ? Math.round((totalCompleted / totalAvailable) * 100) : 0

  const activePhase     = phases.find(p => p.status === 'active' && (!scopeChosen || p.lane_id))
  const completedPhases = phases.filter(p => p.status === 'completed' && (!scopeChosen || p.lane_id)).length

  const mergedPhases = scopedConfig.map(cfg => {
    const row = phases.find(p => p.phase_number === cfg.num)
    return { ...cfg, status: row?.status ?? 'locked', ...phaseStats[cfg.num] }
  })

  // Overall readiness score (avg of all submitted survey scores)
  const scoredSurveys    = surveyResults.filter(r => r.score !== null)
  const overallReadiness = scoredSurveys.length > 0
    ? scoredSurveys.reduce((s, r) => s + r.score, 0) / scoredSurveys.length
    : null

  // Timeline + insights
  const today = new Date()
  const timelinePhases = scopedConfig.map(cfg => {
    const row = phases.find(p => p.phase_number === cfg.num)
    const st  = phaseStats[cfg.num] ?? { available: 0, completed: 0 }
    const pct = st.available > 0 ? Math.round((st.completed / st.available) * 100) : 0
    return { phase_number: cfg.num, name: cfg.name, planned_start: row?.planned_start ?? null,
             planned_end: row?.planned_end ?? null, status: row?.status ?? 'locked', pct, ...st }
  })
  // At-risk: phase past its end date but not finished
  const atRiskPhases = timelinePhases.filter(p =>
    p.planned_end && new Date(p.planned_end) < today && p.pct < 100 && (p.available ?? 0) > 0)
  // Upcoming: milestones + phase starts still ahead, soonest first
  const upcoming = [
    ...milestones.filter(m => m.milestone_date && new Date(m.milestone_date) >= today)
      .map(m => ({ date: m.milestone_date, label: m.name, kind: 'milestone', color: m.color })),
    ...timelinePhases.filter(p => p.planned_start && new Date(p.planned_start) > today)
      .map(p => ({ date: p.planned_start, label: `${p.name} starts`, kind: 'phase' })),
  ].sort((a, b) => new Date(a.date) - new Date(b.date)).slice(0, 5)
  const fmtDate = d => new Date(d).toLocaleDateString('en', { day: 'numeric', month: 'short' })

  // ── AI view (real member) ────────────────────────────────────────────────────
  // Members land in the AI experience by default. The classic dashboard below is kept for
  // the Master Admin "view as" preview (detailed oversight) and is otherwise unreachable.
  if (!preview) {
    const ragLabel = overallReadiness == null ? '—' : overallReadiness >= 3.5 ? 'On track' : overallReadiness >= 2.5 ? 'At risk' : 'Critical'
    const ragColor = overallReadiness == null ? '#94A3B8' : overallReadiness >= 3.5 ? '#16A34A' : overallReadiness >= 2.5 ? '#D97706' : '#DC2626'
    const currentName = activePhase ? (phaseConfig.find(p => p.num === activePhase.phase_number)?.name ?? '—') : (scopedConfig.length > 0 && completedPhases === scopedConfig.length ? 'Complete' : '—')
    const continuePath = activePhase ? (phaseConfig.find(p => p.num === activePhase.phase_number)?.path ?? '#') : null
    return (
      <div className="min-h-full bg-slate-50">
        <div className="bg-gradient-to-br from-[#1F4E79] to-[#163a5c] px-8 py-7">
          <p className="text-white/50 text-xs font-semibold tracking-widest uppercase mb-1">Your AI assistant</p>
          <h1 className="text-2xl font-bold text-white">{greeting}, {firstName} 👋</h1>
          {profile?.role && (
            <p className="text-white/60 text-sm mt-1">
              {roleLabels[profile.role] ?? profile.role}{profile.industry ? ` · ${industryLabels[profile.industry] ?? profile.industry}` : ''}
            </p>
          )}
          {projectsList.length > 1 && (
            <div className="mt-3 flex items-center gap-2">
              <span className="text-xs text-white/60">Project:</span>
              <select value={activeProjectId} onChange={e => switchProject(e.target.value)}
                className="text-xs bg-white/15 text-white border border-white/25 rounded-lg px-2.5 py-1.5 focus:outline-none focus:border-white/60 [&>option]:text-slate-800">
                {projectsList.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
          )}
          {continuePath && (
            <Link to={continuePath}
              className="mt-4 inline-flex items-center gap-2 bg-[#E8913A] text-white text-sm font-semibold px-5 py-2.5 rounded-xl hover:bg-[#d07e2e] transition-colors shadow-lg shadow-orange-900/20">
              Continue Phase {activePhase.phase_number}: {phaseConfig.find(p => p.num === activePhase.phase_number)?.name} →
            </Link>
          )}
        </div>
        <div className="px-8 py-6">
          <AiCanvas
            context="Your change journey — grounded in your own data"
            chips={[
              { color: '#E8913A', tag: 'PROGRESS', label: 'My completion', value: `${progressPct}%`, query: 'My progress' },
              { color: '#1F4E79', tag: 'PHASE', label: 'Current', value: currentName, query: 'My progress' },
              { color: ragColor, tag: 'RAG', label: 'Readiness', value: ragLabel, query: 'My readiness' },
              { color: '#DC2626', tag: 'ATTENTION', label: 'Overdue', value: atRiskPhases.length, query: 'My progress' },
              { color: '#16A34A', tag: 'DUE', label: 'Coming up', value: upcoming.length, query: 'Upcoming milestones' },
            ]}
          />
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-full bg-slate-50">
      {/* Hero header */}
      <div className="bg-gradient-to-br from-[#1F4E79] to-[#163a5c] px-8 py-8">
        <div className="max-w-4xl">
          <p className="text-white/50 text-xs font-semibold tracking-widest uppercase mb-1">Dashboard</p>
          <h1 className="text-3xl font-bold text-white mb-1">{greeting}, {firstName} 👋</h1>
          {profile?.role && (
            <p className="text-white/60 text-sm">
              {roleLabels[profile.role] ?? profile.role}
              {profile.industry ? ` · ${industryLabels[profile.industry] ?? profile.industry}` : ''}
            </p>
          )}

          {projectsList.length > 1 && (
            <div className="mt-4 flex items-center gap-2">
              <span className="text-xs text-white/60">Project:</span>
              <select value={activeProjectId} onChange={e => switchProject(e.target.value)}
                className="text-xs bg-white/15 text-white border border-white/25 rounded-lg px-2.5 py-1.5 focus:outline-none focus:border-white/60 [&>option]:text-slate-800">
                {projectsList.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
          )}
        </div>

        {/* Progress strip */}
        {!loading && phases.length > 0 && (
          <div className="max-w-4xl mt-6 bg-white/10 rounded-2xl px-6 py-5">
            <div className="flex items-center justify-between mb-3">
              <div>
                <p className="text-white text-sm font-semibold">Overall Progress</p>
                <p className="text-white/50 text-xs mt-0.5">
                  {totalCompleted} of {totalAvailable} items completed across all phases
                </p>
              </div>
              <span className="text-2xl font-bold text-[#E8913A]">{progressPct}%</span>
            </div>

            {/* Main progress bar */}
            <div className="h-2.5 bg-white/20 rounded-full overflow-hidden mb-4">
              <div
                className="h-full bg-[#E8913A] rounded-full transition-all duration-700"
                style={{ width: `${progressPct}%` }}
              />
            </div>

            {/* Per-phase mini bars */}
            <div className="grid grid-cols-5 gap-2">
              {mergedPhases.map(ph => {
                const pct = ph.available > 0 ? Math.round((ph.completed / ph.available) * 100) : 0
                return (
                  <div key={ph.num}>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-[9px] text-white/50 font-semibold">{ph.label}</span>
                      {ph.available > 0 && (
                        <span className="text-[9px] text-white/40">{ph.completed}/{ph.available}</span>
                      )}
                    </div>
                    <div className="h-1 bg-white/20 rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all duration-500 ${
                          pct === 100 ? 'bg-green-400' : pct > 0 ? 'bg-[#E8913A]' : 'bg-transparent'
                        }`}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* Continue button */}
        {!loading && activePhase && (
          <div className="max-w-4xl mt-4">
            <Nav
              to={phaseConfig.find(p => p.num === activePhase.phase_number)?.path ?? '#'}
              className="inline-flex items-center gap-2 bg-[#E8913A] text-white text-sm font-semibold px-5 py-2.5 rounded-xl hover:bg-[#d07e2e] transition-colors shadow-lg shadow-orange-900/20"
            >
              Continue Phase {activePhase.phase_number}: {phaseConfig.find(p => p.num === activePhase.phase_number)?.name}
              <span className="text-base">→</span>
            </Nav>
          </div>
        )}
      </div>

      {/* ── TIMELINE + INSIGHTS ─────────────────────────────────────────── */}
      {!loading && phases.length > 0 && (
        <div className="max-w-4xl px-8 pt-8 space-y-4">
          {/* At-risk banner */}
          {atRiskPhases.length > 0 && (
            <div className="bg-amber-50 border border-amber-200 rounded-2xl px-5 py-3">
              <p className="text-xs font-bold text-amber-700 uppercase tracking-widest mb-1">Needs attention</p>
              <div className="flex flex-wrap gap-x-4 gap-y-1">
                {atRiskPhases.map(p => (
                  <span key={p.phase_number} className="text-sm text-amber-800">
                    <strong>{p.name}</strong> overdue · {p.pct}% · was due {fmtDate(p.planned_end)}
                  </span>
                ))}
              </div>
            </div>
          )}

          <div className="grid md:grid-cols-3 gap-4">
            {/* Timeline strip */}
            <div className="md:col-span-2 bg-white rounded-2xl border border-slate-100 p-5">
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-widest mb-4">Project timeline</p>
              <MiniTimeline phases={timelinePhases} milestones={milestones} />
            </div>

            {/* Upcoming */}
            <div className="bg-white rounded-2xl border border-slate-100 p-5">
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-widest mb-3">Upcoming</p>
              {upcoming.length === 0 ? (
                <p className="text-xs text-slate-400">Nothing scheduled ahead.</p>
              ) : (
                <div className="space-y-2.5">
                  {upcoming.map((u, i) => (
                    <div key={i} className="flex items-start gap-2.5">
                      <span className="mt-0.5 shrink-0">
                        {u.kind === 'milestone'
                          ? <svg width="10" height="10" viewBox="0 0 16 16"><path d="M8 0 l8 8 -8 8 -8 -8 z" fill={u.color || '#1F4E79'} /></svg>
                          : <span className="block w-2.5 h-2.5 rounded-full bg-slate-300" />}
                      </span>
                      <div className="min-w-0">
                        <p className="text-sm text-slate-700 leading-tight truncate">{u.label}</p>
                        <p className="text-[11px] text-slate-400">{fmtDate(u.date)}</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── COCKPIT SECTION ─────────────────────────────────────────────── */}
      {!loading && (
        <div className="max-w-4xl px-8 pt-8">
          <p className="text-xs font-semibold tracking-widest text-slate-400 uppercase mb-4">Readiness Cockpit</p>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">

            {/* Survey Readiness tile */}
            <div className="bg-white rounded-2xl border border-slate-100 p-5 col-span-1 md:col-span-2">
              <div className="flex items-center justify-between mb-3">
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-widest">Survey Readiness</p>
                {overallReadiness !== null && (
                  <RagPill score={overallReadiness} green={3.5} amber={2.5} />
                )}
              </div>

              {surveyResults.length === 0 ? (
                <div className="flex items-center gap-3 py-2">
                  <span className="text-2xl">📋</span>
                  <div>
                    <p className="text-sm font-semibold text-slate-700">No surveys submitted yet</p>
                    <p className="text-xs text-slate-400 mt-0.5">Complete readiness surveys in your phase to see scores here.</p>
                  </div>
                </div>
              ) : (
                <div className="space-y-3">
                  {surveyResults.map((r, i) => {
                    const sv = r.survey
                    if (!sv) return null
                    const score = r.score
                    const rag   = getRag(score, sv.rag_green_threshold, sv.rag_amber_threshold)
                    const barColor = rag === 'green' ? 'bg-green-400' : rag === 'amber' ? 'bg-amber-400' : 'bg-red-400'
                    const barPct   = score !== null ? Math.round((score / 5) * 100) : 0
                    return (
                      <div key={i} className="flex items-center gap-3">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between mb-1">
                            <span className="text-xs font-medium text-slate-700 truncate">{sv.title}</span>
                            <div className="flex items-center gap-1.5 shrink-0 ml-2">
                              <span className="text-[10px] text-slate-400">Ph.{sv.phase_number}</span>
                              {score !== null && (
                                <span className="text-[10px] font-bold text-slate-600">{score.toFixed(1)}/5</span>
                              )}
                              <RagPill score={score} green={sv.rag_green_threshold} amber={sv.rag_amber_threshold} />
                            </div>
                          </div>
                          <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
                            <div className={`h-full rounded-full transition-all ${barColor}`} style={{ width: `${barPct}%` }} />
                          </div>
                        </div>
                      </div>
                    )
                  })}

                  {/* Overall avg if multiple surveys */}
                  {scoredSurveys.length > 1 && (
                    <div className="pt-2 border-t border-slate-100 flex items-center justify-between">
                      <span className="text-xs text-slate-400 font-medium">Overall avg</span>
                      <span className="text-sm font-bold text-[#1F4E79]">{overallReadiness.toFixed(1)}/5</span>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Quick-stats tile */}
            <div className="flex flex-col gap-4">
              <div className="bg-white rounded-2xl border border-slate-100 p-5 flex-1">
                <p className="text-xs font-semibold text-slate-400 uppercase tracking-widest mb-2">Templates</p>
                <p className="text-2xl font-bold text-[#1F4E79]">{templateCount}</p>
                <p className="text-xs text-slate-400 mt-1">
                  {templateCount === 0 ? 'None started yet' : `template${templateCount === 1 ? '' : 's'} in progress`}
                </p>
              </div>

              <div className="bg-white rounded-2xl border border-slate-100 p-5 flex-1">
                <p className="text-xs font-semibold text-slate-400 uppercase tracking-widest mb-2">Surveys Done</p>
                <p className="text-2xl font-bold text-[#E8913A]">{surveyResults.length}</p>
                <p className="text-xs text-slate-400 mt-1">
                  {surveyResults.length === 0 ? 'None submitted yet' : `survey${surveyResults.length === 1 ? '' : 's'} submitted`}
                </p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Phase cards */}
      <div className="max-w-4xl px-8 pb-8">
        <p className="text-xs font-semibold tracking-widest text-slate-400 uppercase mb-4">All Phases</p>

        {loading ? (
          <div className="space-y-3">
            {[1,2,3,4,5].map(n => (
              <div key={n} className="h-20 bg-white rounded-2xl border border-slate-100 animate-pulse" />
            ))}
          </div>
        ) : (
          <div className="space-y-3">
            {mergedPhases.map(ph => {
              const isCompleted = ph.status === 'completed'
              const isActive    = ph.status === 'active'
              const isLocked    = ph.status === 'locked'
              const phasePct    = ph.available > 0 ? Math.round((ph.completed / ph.available) * 100) : 0

              // Survey signal for this phase
              const phaseSurveys = surveyResults.filter(r => r.survey?.phase_number === ph.num)
              const phaseAvgScore = phaseSurveys.length > 0
                ? phaseSurveys.filter(r => r.score !== null).reduce((s, r) => s + r.score, 0) / phaseSurveys.filter(r => r.score !== null).length
                : null

              return (
                <div key={ph.num} className={`flex items-center gap-5 p-5 rounded-2xl border transition-all ${
                  isActive    ? 'bg-white border-[#1F4E79]/20 shadow-md shadow-blue-900/5' :
                  isCompleted ? 'bg-white border-slate-100' :
                                'bg-white border-slate-100 opacity-50'
                }`}>
                  {/* Icon */}
                  <div className={`w-12 h-12 rounded-xl flex items-center justify-center shrink-0 text-lg ${
                    phasePct === 100 ? 'bg-green-50' : isActive ? 'bg-[#1F4E79]' : 'bg-slate-100'
                  }`}>
                    {phasePct === 100 ? '✅' : isLocked ? '🔒' : ph.icon}
                  </div>

                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                      <span className="text-[10px] font-bold tracking-widest text-slate-400 uppercase">{ph.label}</span>
                      {isActive && <span className="text-[10px] font-semibold text-[#1F4E79] bg-[#1F4E79]/10 px-2 py-0.5 rounded-full">In Progress</span>}
                      {phasePct === 100 && <span className="text-[10px] font-semibold text-green-600 bg-green-50 px-2 py-0.5 rounded-full">All done ✓</span>}
                      {phaseAvgScore !== null && (
                        <RagPill score={phaseAvgScore} green={3.5} amber={2.5} />
                      )}
                    </div>
                    <p className={`font-semibold text-sm ${isLocked ? 'text-slate-400' : 'text-slate-800'}`}>{ph.name}</p>
                    <p className="text-xs text-slate-400 mt-0.5">{ph.desc}</p>

                    {/* Per-phase mini progress bar */}
                    {!isLocked && ph.available > 0 && (
                      <div className="mt-2 flex items-center gap-2">
                        <div className="flex-1 h-1 bg-slate-100 rounded-full overflow-hidden">
                          <div
                            className={`h-full rounded-full transition-all ${phasePct === 100 ? 'bg-green-400' : 'bg-[#E8913A]'}`}
                            style={{ width: `${phasePct}%` }}
                          />
                        </div>
                        <span className="text-[10px] text-slate-400 shrink-0">
                          {ph.completed}/{ph.available} items
                        </span>
                      </div>
                    )}
                  </div>

                  {/* CTA */}
                  <div className="shrink-0">
                    {(isCompleted || (isActive && phasePct === 100)) && (
                      <Nav to={ph.path} className="text-xs font-medium text-slate-500 hover:text-slate-700 border border-slate-200 hover:border-slate-300 px-3 py-1.5 rounded-lg transition-colors">
                        Review
                      </Nav>
                    )}
                    {isActive && phasePct < 100 && (
                      <Nav to={ph.path} className="bg-[#1F4E79] text-white text-xs font-bold px-4 py-2 rounded-xl hover:bg-[#163a5c] transition-colors shadow-sm">
                        Continue →
                      </Nav>
                    )}
                    {isLocked && (
                      <Nav to={ph.path} className="text-xs text-slate-400 border border-slate-200 px-3 py-1.5 rounded-lg hover:border-slate-300 transition-colors">
                        Preview →
                      </Nav>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}

        {/* Stats row */}
        {!loading && phases.length > 0 && (
          <div className="grid grid-cols-3 gap-4 mt-8">
            <div className="bg-white rounded-2xl border border-slate-100 p-5">
              <p className="text-2xl font-bold text-[#E8913A]">{totalCompleted}</p>
              <p className="text-xs text-slate-400 mt-1 font-medium">Items Completed</p>
            </div>
            <div className="bg-white rounded-2xl border border-slate-100 p-5">
              <p className="text-2xl font-bold text-[#1F4E79]">{totalAvailable - totalCompleted}</p>
              <p className="text-xs text-slate-400 mt-1 font-medium">Items Remaining</p>
            </div>
            <div className="bg-white rounded-2xl border border-slate-100 p-5">
              <p className="text-2xl font-bold text-slate-800">{completedPhases}</p>
              <p className="text-xs text-slate-400 mt-1 font-medium">Phases Complete</p>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
