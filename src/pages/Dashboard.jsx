import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../lib/supabase'

const phaseConfig = [
  {
    num: 1,
    label: '01',
    name: 'Diagnose',
    path: '/phases/diagnose',
    icon: '🔍',
    desc: 'Understand where you are before you move',
    color: 'from-blue-600 to-blue-800',
    lightColor: 'bg-blue-50',
    borderColor: 'border-blue-200',
    textColor: 'text-blue-700',
    dotColor: 'bg-blue-600',
  },
  {
    num: 2,
    label: '02',
    name: 'Design',
    path: '/phases/design',
    icon: '📐',
    desc: 'Build the blueprint for successful change',
    color: 'from-indigo-600 to-indigo-800',
    lightColor: 'bg-indigo-50',
    borderColor: 'border-indigo-200',
    textColor: 'text-indigo-700',
    dotColor: 'bg-indigo-500',
  },
  {
    num: 3,
    label: '03',
    name: 'Engage',
    path: '/phases/engage',
    icon: '🤝',
    desc: 'Bring people with you, not behind you',
    color: 'from-violet-600 to-violet-800',
    lightColor: 'bg-violet-50',
    borderColor: 'border-violet-200',
    textColor: 'text-violet-700',
    dotColor: 'bg-violet-500',
  },
  {
    num: 4,
    label: '04',
    name: 'Embed',
    path: '/phases/embed',
    icon: '🔧',
    desc: 'Make the change stick',
    color: 'from-purple-600 to-purple-800',
    lightColor: 'bg-purple-50',
    borderColor: 'border-purple-200',
    textColor: 'text-purple-700',
    dotColor: 'bg-purple-500',
  },
  {
    num: 5,
    label: '05',
    name: 'Evaluate',
    path: '/phases/evaluate',
    icon: '📊',
    desc: 'Know what worked — and build on it',
    color: 'from-teal-600 to-teal-800',
    lightColor: 'bg-teal-50',
    borderColor: 'border-teal-200',
    textColor: 'text-teal-700',
    dotColor: 'bg-teal-500',
  },
]

const roleLabels = {
  po: 'Product Owner',
  cm: 'Change Manager',
  pm: 'Project Manager',
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

export default function Dashboard() {
  const { profile, user } = useAuth()
  const [phases, setPhases]   = useState([])
  const [project, setProject] = useState(null)
  const [loading, setLoading] = useState(true)

  const firstName = profile?.full_name
    ? profile.full_name.split(' ')[0]
    : 'back'

  const hour = new Date().getHours()
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening'

  useEffect(() => {
    if (!user) return
    async function load() {
      setLoading(true)
      // Fetch the user's most recent project
      const { data: proj } = await supabase
        .from('projects')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
        .limit(1)
        .single()

      if (!proj) { setLoading(false); return }
      setProject(proj)

      // Fetch all phases for this project
      const { data: phaseRows } = await supabase
        .from('project_phases')
        .select('*')
        .eq('project_id', proj.id)
        .order('phase_number', { ascending: true })

      setPhases(phaseRows ?? [])
      setLoading(false)
    }
    load()
  }, [user])

  const completedCount = phases.filter(p => p.status === 'completed').length
  const activePhase    = phases.find(p => p.status === 'active')
  const progressPct    = phases.length > 0 ? Math.round((completedCount / phases.length) * 100) : 0

  // Merge DB status into phaseConfig
  const mergedPhases = phaseConfig.map(cfg => {
    const row = phases.find(p => p.phase_number === cfg.num)
    return { ...cfg, status: row?.status ?? 'locked' }
  })

  return (
    <div className="min-h-full bg-slate-50">
      {/* Hero header */}
      <div className="bg-gradient-to-br from-[#1F4E79] to-[#163a5c] px-8 py-8">
        <div className="max-w-4xl">
          <p className="text-white/50 text-xs font-semibold tracking-widest uppercase mb-1">Dashboard</p>
          <h1 className="text-3xl font-bold text-white mb-1">
            {greeting}, {firstName} 👋
          </h1>
          {profile?.role && (
            <p className="text-white/60 text-sm">
              {roleLabels[profile.role] ?? profile.role}
              {profile.industry ? ` · ${industryLabels[profile.industry] ?? profile.industry}` : ''}
            </p>
          )}
        </div>

        {/* Progress strip */}
        {!loading && phases.length > 0 && (
          <div className="max-w-4xl mt-6 bg-white/10 rounded-2xl px-6 py-4">
            <div className="flex items-center justify-between mb-3">
              <div>
                <p className="text-white text-sm font-semibold">Your Progress</p>
                <p className="text-white/50 text-xs mt-0.5">
                  {completedCount} of {phases.length} phases complete
                </p>
              </div>
              <span className="text-2xl font-bold text-[#E8913A]">{progressPct}%</span>
            </div>
            {/* Progress bar */}
            <div className="h-2 bg-white/20 rounded-full overflow-hidden">
              <div
                className="h-full bg-[#E8913A] rounded-full transition-all duration-700"
                style={{ width: `${progressPct}%` }}
              />
            </div>
            {/* Phase dots */}
            <div className="flex items-center justify-between mt-3">
              {mergedPhases.map(ph => (
                <div key={ph.num} className="flex flex-col items-center gap-1">
                  <div className={`w-2.5 h-2.5 rounded-full ${
                    ph.status === 'completed'
                      ? 'bg-[#E8913A]'
                      : ph.status === 'active'
                        ? 'bg-white ring-2 ring-white/50 ring-offset-1 ring-offset-transparent'
                        : 'bg-white/20'
                  }`} />
                  <span className="text-[9px] text-white/40 font-medium">{ph.label}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Quick continue button */}
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

      {/* Phase cards */}
      <div className="max-w-4xl px-8 py-8">
        <p className="text-xs font-semibold tracking-widest text-slate-400 uppercase mb-4">All Phases</p>

        {loading ? (
          <div className="space-y-3">
            {[1,2,3,4,5].map(n => (
              <div key={n} className="h-20 bg-white rounded-2xl border border-slate-100 animate-pulse" />
            ))}
          </div>
        ) : (
          <div className="space-y-3">
            {mergedPhases.map((ph, i) => {
              const isCompleted = ph.status === 'completed'
              const isActive    = ph.status === 'active'
              const isLocked    = ph.status === 'locked'

              return (
                <div
                  key={ph.num}
                  className={`flex items-center gap-5 p-5 rounded-2xl border transition-all ${
                    isActive
                      ? 'bg-white border-[#1F4E79]/20 shadow-md shadow-blue-900/5'
                      : isCompleted
                        ? 'bg-white border-slate-100'
                        : 'bg-white border-slate-100 opacity-50'
                  }`}
                >
                  {/* Phase number / status icon */}
                  <div className={`w-12 h-12 rounded-xl flex items-center justify-center shrink-0 text-lg ${
                    isCompleted
                      ? 'bg-green-50'
                      : isActive
                        ? 'bg-[#1F4E79]'
                        : 'bg-slate-100'
                  }`}>
                    {isCompleted ? '✅' : isLocked ? '🔒' : ph.icon}
                  </div>

                  {/* Label + desc */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className="text-[10px] font-bold tracking-widest text-slate-400 uppercase">{ph.label}</span>
                      {isCompleted && (
                        <span className="text-[10px] font-semibold text-green-600 bg-green-50 px-2 py-0.5 rounded-full">Completed</span>
                      )}
                      {isActive && (
                        <span className="text-[10px] font-semibold text-[#1F4E79] bg-[#1F4E79]/10 px-2 py-0.5 rounded-full">In Progress</span>
                      )}
                    </div>
                    <p className={`font-semibold text-sm ${isLocked ? 'text-slate-400' : 'text-slate-800'}`}>
                      {ph.name}
                    </p>
                    <p className="text-xs text-slate-400 mt-0.5 truncate">{ph.desc}</p>
                  </div>

                  {/* CTA */}
                  <div className="shrink-0">
                    {isCompleted && (
                      <Link
                        to={ph.path}
                        className="text-xs font-medium text-slate-500 hover:text-slate-700 border border-slate-200 hover:border-slate-300 px-3 py-1.5 rounded-lg transition-colors"
                      >
                        Review
                      </Link>
                    )}
                    {isActive && (
                      <Link
                        to={ph.path}
                        className="bg-[#1F4E79] text-white text-xs font-bold px-4 py-2 rounded-xl hover:bg-[#163a5c] transition-colors shadow-sm"
                      >
                        Continue →
                      </Link>
                    )}
                    {isLocked && (
                      <span className="text-xs text-slate-300 border border-slate-200 px-3 py-1.5 rounded-lg">
                        Locked
                      </span>
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
              <p className="text-2xl font-bold text-slate-800">{completedCount}</p>
              <p className="text-xs text-slate-400 mt-1 font-medium">Phases Complete</p>
            </div>
            <div className="bg-white rounded-2xl border border-slate-100 p-5">
              <p className="text-2xl font-bold text-[#1F4E79]">{phases.filter(p => p.status === 'active').length}</p>
              <p className="text-xs text-slate-400 mt-1 font-medium">Phase Active</p>
            </div>
            <div className="bg-white rounded-2xl border border-slate-100 p-5">
              <p className="text-2xl font-bold text-slate-300">{phases.filter(p => p.status === 'locked').length}</p>
              <p className="text-xs text-slate-400 mt-1 font-medium">Phases Remaining</p>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
