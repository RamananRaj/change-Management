import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../lib/supabase'
import ExerciseDrawer from './ExerciseDrawer'
import TemplateDrawer from './TemplateDrawer'


const typeConfig = {
  exercise: {
    label: 'Exercises',
    icon: '🎯',
    color: 'bg-blue-50 border-blue-100',
    badge: 'bg-blue-100 text-blue-700',
  },
  tool: {
    label: 'Tools',
    icon: '🔧',
    color: 'bg-green-50 border-green-100',
    badge: 'bg-green-100 text-green-700',
  },
  template: {
    label: 'Templates',
    icon: '📄',
    color: 'bg-purple-50 border-purple-100',
    badge: 'bg-purple-100 text-purple-700',
  },
}

const phaseColors = [
  null,
  { bg: 'from-blue-600 to-blue-800' },
  { bg: 'from-indigo-600 to-indigo-800' },
  { bg: 'from-violet-600 to-violet-800' },
  { bg: 'from-purple-600 to-purple-800' },
  { bg: 'from-teal-600 to-teal-800' },
]

const phasePaths = {
  1: '/phases/diagnose',
  2: '/phases/design',
  3: '/phases/engage',
  4: '/phases/embed',
  5: '/phases/evaluate',
}

const phaseNames = {
  1: 'Diagnose', 2: 'Design', 3: 'Engage', 4: 'Embed', 5: 'Evaluate',
}

export default function PhasePageLayout({ phaseNum, title, subtitle }) {
  const { profile, user } = useAuth()
  const [items,           setItems]           = useState([])
  const [templates,       setTemplates]       = useState([])
  const [allPhases,       setAllPhases]       = useState([])
  const [activities,      setActivities]      = useState([])
  const [loading,         setLoading]         = useState(true)
  const [activeType,      setActiveType]      = useState('exercise')
  const [drawerItem,      setDrawerItem]      = useState(null)
  const [templateItem,    setTemplateItem]    = useState(null)
  const [scopeFilter,     setScopeFilter]     = useState('all')
  // Live label lookups from Supabase (roles + industries)
  const [roleLabel,     setRoleLabel]     = useState(null)
  const [industryLabel, setIndustryLabel] = useState(null)
  const [industryIcon,  setIndustryIcon]  = useState(null)

  const color = phaseColors[phaseNum] ?? phaseColors[1]

  useEffect(() => {
    if (!profile || !user) return
    loadAll()
    loadLabels()
  }, [profile, user])

  async function loadAll() {
    setLoading(true)

    // Fetch all phases for this user's project
    const { data: proj } = await supabase
      .from('projects')
      .select('id')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(1)
      .single()

    if (proj) {
      const { data: phaseRows } = await supabase
        .from('project_phases')
        .select('*')
        .eq('project_id', proj.id)
        .order('phase_number', { ascending: true })
      setAllPhases(phaseRows ?? [])
    }

    // Fetch content filtered by industry + role
    const { data } = await supabase
      .from('phase_content')
      .select('*')
      .eq('phase_number', phaseNum)
      .or(`industry.is.null,industry.eq.${profile.industry ?? '__none__'}`)
      .or(`role.is.null,role.eq.${profile.role ?? '__none__'}`)
      .order('sort_order', { ascending: true })

    setItems(data ?? [])

    // Fetch templates for this phase filtered by industry + role
    const { data: tmplData } = await supabase
      .from('templates')
      .select('*')
      .eq('phase_number', phaseNum)
      .eq('is_active', true)
      .or(`industry.is.null,industry.eq.${profile.industry ?? '__none__'}`)
      .or(`role.is.null,role.eq.${profile.role ?? '__none__'}`)
      .order('sort_order', { ascending: true })
    setTemplates(tmplData ?? [])

    // Fetch this user's activity records for this phase
    await fetchActivities()

    setLoading(false)
  }

  async function loadLabels() {
    if (profile?.role) {
      const { data: r } = await supabase.from('roles').select('label').eq('code', profile.role).single()
      if (r) setRoleLabel(r.label)
    }
    if (profile?.industry) {
      const { data: i } = await supabase.from('industries').select('label, icon').eq('code', profile.industry).single()
      if (i) { setIndustryLabel(i.label); setIndustryIcon(i.icon) }
    }
  }

  async function fetchActivities() {
    const { data } = await supabase
      .from('user_activities')
      .select('*')
      .eq('user_id', user.id)
      .eq('phase_number', phaseNum)
    setActivities(data ?? [])
  }

  const thisPhase    = allPhases.find(p => p.phase_number === phaseNum)
  const phaseStatus  = thisPhase?.status ?? null
  const activePhase  = allPhases.find(p => p.status === 'active')
  const completedCount = allPhases.filter(p => p.status === 'completed').length
  const progressPct  = allPhases.length > 0 ? Math.round((completedCount / allPhases.length) * 100) : 0
  const isLocked     = phaseStatus === 'locked' && !profile?.is_admin

  // Scope filter counts (for pill labels)
  const scopeCounts = {
    all:      items.length,
    common:   items.filter(i => !i.industry && !i.role).length,
    industry: items.filter(i => i.industry === profile?.industry && !i.role).length,
    role:     items.filter(i => i.role === profile?.role && !i.industry).length,
  }

  // Apply scope filter
  const scopedItems = scopeFilter === 'common'
    ? items.filter(i => !i.industry && !i.role)
    : scopeFilter === 'industry'
    ? items.filter(i => i.industry === profile?.industry && !i.role)
    : scopeFilter === 'role'
    ? items.filter(i => i.role === profile?.role && !i.industry)
    : items  // 'all'

  const grouped = {
    exercise: scopedItems.filter(i => i.content_type === 'exercise'),
    tool:     scopedItems.filter(i => i.content_type === 'tool'),
    template: scopedItems.filter(i => i.content_type === 'template'),
  }

  const tabs = ['exercise', 'tool', 'template'].filter(t => grouped[t].length > 0)

  // If active tab has no items in the current scope, fall back to first available tab
  const displayType = tabs.includes(activeType) ? activeType : (tabs[0] ?? 'exercise')

  // Scope filter pills to show
  const scopePills = [
    { key: 'all',      label: 'All',                                         count: scopeCounts.all },
    { key: 'common',   label: 'Common',                                      count: scopeCounts.common },
    ...(profile?.industry && scopeCounts.industry > 0
      ? [{ key: 'industry', label: `${industryIcon ?? ''} ${industryLabel ?? profile.industry}`, count: scopeCounts.industry }]
      : []),
    ...(profile?.role && scopeCounts.role > 0
      ? [{ key: 'role', label: roleLabel ?? profile.role, count: scopeCounts.role }]
      : []),
  ]

  return (
    <div className="min-h-full bg-slate-50">
      {/* Phase hero */}
      <div className={`bg-gradient-to-br ${color.bg} px-8 py-8`}>
        <div className="max-w-4xl">
          <div className="flex items-center gap-2 mb-3">
            <span className="text-xs font-bold tracking-widest text-white/60 uppercase">
              Phase {String(phaseNum).padStart(2, '0')}
            </span>
            {isLocked && (
              <span className="text-xs font-semibold text-amber-300 bg-amber-400/20 border border-amber-400/30 px-2 py-0.5 rounded-full">
                Coming Up
              </span>
            )}
            {profile?.industry && (
              <span className="text-xs font-medium text-white/60 bg-white/10 px-2 py-0.5 rounded-full">
                {industryIcon} {industryLabel ?? profile.industry}
              </span>
            )}
            {profile?.role && (
              <span className="text-xs font-medium text-white/60 bg-white/10 px-2 py-0.5 rounded-full">
                {roleLabel ?? profile.role}
              </span>
            )}
          </div>
          <h1 className="text-3xl font-bold text-white mb-1">{title}</h1>
          <p className="text-white/60 text-sm">{subtitle}</p>
        </div>

        {/* Tab pills + scope filter — only for unlocked phases */}
        {!loading && !isLocked && (
          <div className="mt-5 space-y-2">
            {/* Content type tabs */}
            <div className="flex gap-2 flex-wrap">
              {Object.entries(typeConfig).map(([type, cfg]) => grouped[type]?.length > 0 && (
                <button
                  key={type}
                  onClick={() => setActiveType(type)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold transition-all ${
                    activeType === type
                      ? 'bg-white text-slate-800 shadow'
                      : 'bg-white/15 text-white hover:bg-white/25'
                  }`}
                >
                  <span>{cfg.icon}</span>
                  {cfg.label}
                  <span className={`ml-1 rounded-full w-4 h-4 flex items-center justify-center text-[10px] font-bold ${
                    activeType === type ? 'bg-slate-200 text-slate-600' : 'bg-white/20 text-white'
                  }`}>{grouped[type].length}</span>
                </button>
              ))}
              {/* Templates tab */}
              {templates.length > 0 && (
                <button
                  onClick={() => setActiveType('templates')}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold transition-all ${
                    activeType === 'templates'
                      ? 'bg-white text-slate-800 shadow'
                      : 'bg-white/15 text-white hover:bg-white/25'
                  }`}
                >
                  <span>📋</span>
                  Templates
                  <span className={`ml-1 rounded-full w-4 h-4 flex items-center justify-center text-[10px] font-bold ${
                    activeType === 'templates' ? 'bg-slate-200 text-slate-600' : 'bg-white/20 text-white'
                  }`}>{templates.length}</span>
                </button>
              )}
            </div>

            {/* Scope filter — only show if there are multiple scopes */}
            {scopePills.length > 1 && (
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-[10px] text-white/40 font-semibold uppercase tracking-widest">Show:</span>
                {scopePills.map(pill => (
                  <button
                    key={pill.key}
                    onClick={() => setScopeFilter(pill.key)
                    className={`flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-semibold transition-all ${
                      scopeFilter === pill.key
                        ? 'bg-white/90 text-slate-700 shadow-sm'
                        : 'bg-white/10 text-white/70 hover:bg-white/20'
                    }`}
                  >
                    {pill.label}
                    <span className={`rounded-full px-1 text-[9px] font-bold ${
                      scopeFilter === pill.key ? 'text-slate-500' : 'text-white/50'
                    }`}>{pill.count}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Content area */}
      <div className="max-w-4xl px-8 py-8">
        {loading ? (
          <div className="space-y-3">
            {[1, 2, 3].map(n => (
              <div key={n} className="h-20 bg-white rounded-2xl border border-slate-100 animate-pulse" />
            ))}
          </div>
        ) : isLocked ? (
          /* ── LOCKED: progress nudge + blurred preview ── */
          <div>
            {/* Progress nudge banner */}
            <div className="bg-white border border-amber-200 rounded-2xl p-5 mb-6 flex items-start gap-4">
              <div className="w-10 h-10 bg-amber-50 rounded-xl flex items-center justify-center text-xl shrink-0">⏳</div>
              <div className="flex-1">
                <p className="font-semibold text-slate-800 text-sm mb-0.5">
                  Complete Phase {activePhase ? String(activePhase.phase_number).padStart(2, '0') : 'your current phase'} first
                </p>
                <p className="text-slate-500 text-xs mb-3">
                  You're {progressPct}% through your change journey.
                  {activePhase
                    ? ` Finish ${phaseNames[activePhase.phase_number]} to unlock ${title}.`
                    : ` Your admin can also open this phase for you on request.`}
                </p>
                {/* Mini progress bar */}
                <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden mb-3">
                  <div
                    className="h-full bg-[#E8913A] rounded-full transition-all"
                    style={{ width: `${progressPct}%` }}
                  />
                </div>
                <div className="flex gap-2">
                  {activePhase && (
                    <Link
                      to={phasePaths[activePhase.phase_number]}
                      className="text-xs font-semibold bg-[#1F4E79] text-white px-4 py-1.5 rounded-lg hover:bg-[#163a5c] transition-colors"
                    >
                      Go to Phase {activePhase.phase_number}: {phaseNames[activePhase.phase_number]} →
                    </Link>
                  )}
                  <Link
                    to="/dashboard"
                    className="text-xs font-semibold text-slate-500 border border-slate-200 px-4 py-1.5 rounded-lg hover:border-slate-300 transition-colors"
                  >
                    Back to Dashboard
                  </Link>
                </div>
              </div>
            </div>

            {/* Blurred preview of what's inside */}
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-widest mb-3">
              Preview — {items.length} items in this phase
            </p>
            <div className="space-y-2 select-none pointer-events-none">
              {items.slice(0, 5).map(item => (
                <div key={item.id} className="flex items-center gap-3 bg-white border border-slate-100 rounded-xl p-4 opacity-40">
                  <div className={`w-8 h-8 rounded-lg flex items-center justify-center text-sm shrink-0 ${typeConfig[item.content_type]?.color ?? 'bg-slate-50'}`}>
                    {typeConfig[item.content_type]?.icon}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="h-3 bg-slate-200 rounded w-2/3 mb-1.5" />
                    <div className="h-2 bg-slate-100 rounded w-full" />
                  </div>
                  <span className="text-slate-200 text-xs">🔒</span>
                </div>
              ))}
              {items.length > 5 && (
                <p className="text-center text-xs text-slate-300 py-2">
                  +{items.length - 5} more items waiting…
                </p>
              )}
            </div>
          </div>
        ) : items.length === 0 ? (
          <div className="text-center py-16 bg-white rounded-2xl border border-slate-100">
            <p className="text-3xl mb-3">📭</p>
            <p className="text-slate-500 text-sm">No content added for this phase yet.</p>
            <p className="text-slate-400 text-xs mt-1">Admins can add content in Platform Admin → Content Manager.</p>
          </div>
        ) : (
          /* ── UNLOCKED: full interactive content ── */
          <>
            {/* Templates view */}
            {activeType === 'templates' ? (
              <div>
                <div className="flex items-center gap-2 mb-4">
                  <span className="text-lg">📋</span>
                  <h2 className="font-bold text-slate-800">Templates</h2>
                  <span className="text-xs text-slate-400">({templates.length})</span>
                </div>
                <div className="space-y-3">
                  {templates.map(tmpl => (
                    <TemplateCard
                      key={tmpl.id}
                      template={tmpl}
                      industryLabel={industryLabel}
                      industryIcon={industryIcon}
                      roleLabel={roleLabel}
                      onOpen={() => setTemplateItem(tmpl)}
                    />
                  ))}
                </div>
              </div>
            ) : tabs.length === 0 ? (
              <div className="text-center py-12 bg-white rounded-2xl border border-slate-100">
                <p className="text-2xl mb-2">🔍</p>
                <p className="text-slate-500 text-sm">No content in this filter.</p>
                <button onClick={() => setScopeFilter('all')} className="text-xs text-[#1F4E79] font-semibold mt-2 hover:underline">
                  Show all content
                </button>
              </div>
            ) : (
              <div>
                <div className="flex items-center gap-2 mb-4">
                  <span className="text-lg">{typeConfig[displayType].icon}</span>
                  <h2 className="font-bold text-slate-800">{typeConfig[displayType].label}</h2>
                  <span className="text-xs text-slate-400">({grouped[displayType].length})</span>
                </div>
                <div className="space-y-3">
                  {grouped[displayType].map(item => {
                    const activity = activities.find(a => a.content_id === item.id)
                    return (
                      <ContentCard
                        key={item.id}
                        item={item}
                        typeCfg={typeConfig[displayType]}
                        activity={activity}
                        industryLabel={industryLabel}
                        industryIcon={industryIcon}
                        roleLabel={roleLabel}
                        onStart={() => setDrawerItem(item)}
                      />
                    )
                  })}
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* Exercise / Tool drawer */}
      {drawerItem && (
        <ExerciseDrawer
          item={drawerItem}
          activity={activities.find(a => a.content_id === drawerItem.id)}
          onClose={() => setDrawerItem(null)}
          onActivityChange={fetchActivities}
        />
      )}

      {/* Template drawer */}
      {templateItem && (
        <TemplateDrawer
          template={templateItem}
          onClose={() => setTemplateItem(null)}
        />
      )}
    </div>
  )
}

function TemplateCard({ template, industryLabel, industryIcon, roleLabel, onOpen }) {
  return (
    <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden hover:shadow-md transition-shadow">
      <div className="flex items-start gap-4 p-5">
        <div className="w-10 h-10 rounded-xl bg-purple-50 flex items-center justify-center shrink-0 text-base">📋</div>
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-1.5 mb-1">
            <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-purple-100 text-purple-700">template</span>
            {template.industry && (
              <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-100">
                {industryIcon} {industryLabel ?? template.industry}
              </span>
            )}
            {template.role && (
              <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-slate-100 text-slate-600">
                {roleLabel ?? template.role}
              </span>
            )}
          </div>
          <p className="font-semibold text-slate-800 text-sm">{template.title}</p>
          {template.description && (
            <p className="text-xs text-slate-400 mt-0.5 line-clamp-1">{template.description}</p>
          )}
          {/* Column preview */}
          {(template.columns ?? []).length > 0 && (
            <div className="flex flex-wrap gap-1 mt-2">
              {template.columns.slice(0, 5).map(col => (
                <span key={col.key} className="text-[10px] bg-slate-50 border border-slate-200 text-slate-500 px-1.5 py-0.5 rounded">
                  {col.label}
                </span>
              ))}
              {template.columns.length > 5 && (
                <span className="text-[10px] text-slate-400">+{template.columns.length - 5} more</span>
              )}
            </div>
          )}
        </div>
        <button
          onClick={onOpen}
          className="shrink-0 bg-[#1F4E79] text-white text-xs font-bold px-4 py-2 rounded-xl hover:bg-[#163a5c] transition-colors"
        >
          Open →
        </button>
      </div>
    </div>
  )
}

function ContentCard({ item, typeCfg, activity, industryLabel, industryIcon, roleLabel, onStart }) {
  const [expanded, setExpanded] = useState(false)

  const isCompleted  = activity?.status === 'completed'
  const isInProgress = activity?.status === 'in_progress'

  return (
    <div className={`bg-white border rounded-2xl overflow-hidden transition-shadow hover:shadow-md ${
      isCompleted ? 'border-green-200' : item.industry || item.role ? 'border-slate-200' : 'border-slate-100'
    }`}>
      <div className="flex items-start gap-4 p-5 cursor-pointer" onClick={() => setExpanded(!expanded)}>
        {/* Icon — green tick if completed */}
        <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 text-base ${
          isCompleted ? 'bg-green-50' : typeCfg.color
        }`}>
          {isCompleted ? '✅' : typeCfg.icon}
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-1.5 mb-1">
            <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${typeCfg.badge}`}>
              {item.content_type}
            </span>
            {isCompleted && (
              <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-green-100 text-green-700">Completed</span>
            )}
            {isInProgress && (
              <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-blue-100 text-blue-700">In Progress</span>
            )}
            {item.industry && (
              <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-100">
                {industryIcon} {industryLabel ?? item.industry}
              </span>
            )}
            {item.role && (
              <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-slate-100 text-slate-600">
                {roleLabel ?? item.role}
              </span>
            )}
          </div>
          <p className="font-semibold text-slate-800 text-sm">{item.title}</p>
          {!expanded && item.description && (
            <p className="text-xs text-slate-400 mt-0.5 line-clamp-1">{item.description}</p>
          )}
        </div>
        <span className={`text-slate-300 transition-transform shrink-0 mt-1 ${expanded ? 'rotate-180' : ''}`}>▼</span>
      </div>

      {expanded && (
        <div className="px-5 pb-5 -mt-2">
          {item.description && (
            <div className="bg-slate-50 rounded-xl p-4 border border-slate-100 mb-3">
              <p className="text-sm text-slate-600 leading-relaxed">{item.description}</p>
            </div>
          )}
          {activity?.notes && (
            <div className="bg-blue-50 rounded-xl p-3 border border-blue-100 mb-3">
              <p className="text-[10px] font-semibold text-blue-400 uppercase tracking-widest mb-1">Your notes</p>
              <p className="text-xs text-slate-600 leading-relaxed whitespace-pre-wrap line-clamp-3">{activity.notes}</p>
            </div>
          )}
          <div className="flex gap-3">
            <button
              onClick={e => { e.stopPropagation(); onStart() }}
              className={`text-xs font-bold px-4 py-2 rounded-lg transition-colors ${
                isCompleted
                  ? 'text-slate-500 border border-slate-200 hover:border-slate-300'
                  : 'text-white bg-[#1F4E79] hover:bg-[#163a5c]'
              }`}
            >
              {isCompleted ? 'Review notes' : isInProgress ? 'Continue →' : `Start this ${item.content_type} →`}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
