import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../lib/supabase'

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

export default function Dashboard() {
  const { profile, user } = useAuth()
  const [phases,         setPhases]         = useState([])
  const [phaseStats,     setPhaseStats]     = useState({})
  const [surveyResults,  setSurveyResults]  = useState([])   // submitted survey responses
  const [templateCount,  setTemplateCount]  = useState(0)    // templates started by user
  const [loading,        setLoading]        = useState(true)

  const firstName = profile?.full_name ? profile.full_name.split(' ')[0] : 'back'
  const hour      = new Date().getHours()
  const greeting  = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening'

  useEffect(() => {
    if (!user || !profile) return
    load()
  }, [user, profile])

  async function load() {
    setLoading(true)

    // 1. Fetch project + phases
    const { data: proj } = await supabase
      .from('projects')
      .select('id')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(1)
      .single()

    if (!proj) { setLoading(false); return }

    const { data: phaseRows } = await supabase
      .from('project_phases')
      .select('*')
      .eq('project_id', proj.id)
      .order('phase_number', { ascending: true })
    setPhases(phaseRows ?? [])

    // 2. Fetch all available content for this user's role + industry
    const { data: contentItems } = await supabase
      .from('phase_content')
      .select('id, phase_number')
      .or(`industry.is.null,industry.eq.${profile.industry ?? '__none__'}`)
      .or(`role.is.null,role.eq.${profile.role ?? '__none__'}`)

    // 3. Fetch all completed activities for this user
    const { data: completedActs } = await supabase
      .from('user_activities')
      .select('content_id, phase_number')
      .eq('user_id', user.id)
      .eq('status', 'completed')

    // 4. Build per-phase stats
    const stats = {}
    for (const cfg of phaseConfig) {
      const available = (contentItems ?? []).filter(c => c.phase_number === cfg.num).length
      const completed = (completedActs ?? []).filter(a => a.phase_number === cfg.num).length
      stats[cfg.num] = { available, completed }
    }
    setPhaseStats(stats)

    // 5. Fetch submitted survey responses for this user (with survey metadata)
    const { data: surveyResps } = await supabase
      .from('survey_responses')
      .select('score, submitted_at, surveys(id, title, phase_number, rag_green_threshold, rag_amber_threshold)')
      .eq('user_id', user.id)
      .not('submitted_at', 'is', null)
      .order('submitted_at', { ascending: false })
    setSurveyResults(surveyResps ?? [])

    // 6. Fetch template responses started/saved by this user
    const { data: tmplResps } = await supabase
      .from('template_responses')
      .select('id')
      .eq('user_id', user.id)
    setTemplateCount((tmplResps ?? []).length)

    setLoading(false)
  }

  // Progress calculations
  const totalAvailable = Object.values(phaseStats).reduce((s, p) => s + p.available, 0)
  const totalCompleted = Object.values(phaseStats).reduce((s, p) => s + p.completed, 0)
  const progressPct    = totalAvailable > 0 ? Math.round((totalCompleted / totalAvailable) * 100) : 0

  const activePhase     = phases.find(p => p.status === 'active')
  const completedPhases = phases.filter(p => p.status === 'completed').length

  const mergedPhases = phaseConfig.map(cfg => {
    const row = phases.find(p => p.phase_number === cfg.num)
    return { ...cfg, status: row?.status ?? 'locked', ...phaseStats[cfg.num] }
  })

  // Overall readiness score (avg of all submitted survey scores)
  const scoredSurveys    = surveyResults.filter(r => r.score !== null)
  const overallReadiness = scoredSurveys.length > 0
    ? scoredSurveys.reduce((s, r) => s + r.score, 0) / scoredSurveys.length
    : null

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
            <Link
              to={phaseConfig.find(p => p.num === activePhase.phase_number)?.path ?? '#'}
              className="inline-flex items-center gap-2 bg-[#E8913A] text-white text-sm font-semibold px-5 py-2.5 rounded-xl hover:bg-[#d07e2e] transition-colors shadow-lg shadow-orange-900/20"
            >
              Continue Phase {activePhase.phase_number}: {phaseConfig.find(p => p.num === activePhase.phase_number)?.name}
              <span className="text-base">→</span>
            </Link>
          </div>
        )}
      </div>

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
                    const sv = r.surveys
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
              const phaseSurveys = surveyResults.filter(r => r.surveys?.phase_number === ph.num)
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
                      <Link to={ph.path} className="text-xs font-medium text-slate-500 hover:text-slate-700 border border-slate-200 hover:border-slate-300 px-3 py-1.5 rounded-lg transition-colors">
                        Review
                      </Link>
                    )}
                    {isActive && phasePct < 100 && (
                      <Link to={ph.path} className="bg-[#1F4E79] text-white text-xs font-bold px-4 py-2 rounded-xl hover:bg-[#163a5c] transition-colors shadow-sm">
                        Continue →
                      </Link>
                    )}
                    {isLocked && (
                      <Link to={ph.path} className="text-xs text-slate-400 border border-slate-200 px-3 py-1.5 rounded-lg hover:border-slate-300 transition-colors">
                        Preview →
                      </Link>
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
