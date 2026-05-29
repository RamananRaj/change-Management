import { useState, useEffect } from 'react'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../lib/supabase'

const industryLabels = {
  'financial-services': '🏦 Financial Services',
  'healthcare':         '🏥 Healthcare',
  'utilities-energy':   '⚡ Utilities & Energy',
  'telecommunications': '📡 Telecommunications',
  'manufacturing':      '🏭 Manufacturing',
  'public-sector':      '🏛 Public Sector',
  'retail-consumer':    '🛒 Retail & Consumer',
}

const roleLabels = {
  po: 'Product Owner',
  cm: 'Change Manager',
  pm: 'Project Manager',
}

const typeConfig = {
  exercise: {
    label: 'Exercises',
    icon: '🎯',
    color: 'bg-blue-50 border-blue-100',
    badge: 'bg-blue-100 text-blue-700',
    heading: 'text-blue-800',
  },
  tool: {
    label: 'Tools',
    icon: '🔧',
    color: 'bg-green-50 border-green-100',
    badge: 'bg-green-100 text-green-700',
    heading: 'text-green-800',
  },
  template: {
    label: 'Templates',
    icon: '📄',
    color: 'bg-purple-50 border-purple-100',
    badge: 'bg-purple-100 text-purple-700',
    heading: 'text-purple-800',
  },
}

const phaseColors = [
  null,
  { bg: 'from-blue-600 to-blue-800',   light: 'bg-blue-50',   text: 'text-blue-700',   badge: 'bg-blue-100 text-blue-800'   },
  { bg: 'from-indigo-600 to-indigo-800', light: 'bg-indigo-50', text: 'text-indigo-700', badge: 'bg-indigo-100 text-indigo-800' },
  { bg: 'from-violet-600 to-violet-800', light: 'bg-violet-50', text: 'text-violet-700', badge: 'bg-violet-100 text-violet-800' },
  { bg: 'from-purple-600 to-purple-800', light: 'bg-purple-50', text: 'text-purple-700', badge: 'bg-purple-100 text-purple-800' },
  { bg: 'from-teal-600 to-teal-800',   light: 'bg-teal-50',   text: 'text-teal-700',   badge: 'bg-teal-100 text-teal-800'   },
]

export default function PhasePageLayout({ phaseNum, title, subtitle }) {
  const { profile } = useAuth()
  const [items,      setItems]      = useState([])
  const [loading,    setLoading]    = useState(true)
  const [activeType, setActiveType] = useState('exercise')

  const color = phaseColors[phaseNum] ?? phaseColors[1]

  useEffect(() => {
    if (!profile) return
    fetchContent()
  }, [profile])

  async function fetchContent() {
    setLoading(true)
    const { data } = await supabase
      .from('phase_content')
      .select('*')
      .eq('phase_number', phaseNum)
      .or(`industry.is.null,industry.eq.${profile.industry ?? '__none__'}`)
      .or(`role.is.null,role.eq.${profile.role ?? '__none__'}`)
      .order('sort_order', { ascending: true })

    setItems(data ?? [])
    setLoading(false)
  }

  const grouped = {
    exercise: items.filter(i => i.content_type === 'exercise'),
    tool:     items.filter(i => i.content_type === 'tool'),
    template: items.filter(i => i.content_type === 'template'),
  }

  const tabs = ['exercise', 'tool', 'template'].filter(t => grouped[t].length > 0)

  return (
    <div className="min-h-full bg-slate-50">
      {/* Phase hero */}
      <div className={`bg-gradient-to-br ${color.bg} px-8 py-8`}>
        <div className="max-w-4xl">
          <div className="flex items-center gap-2 mb-3">
            <span className="text-xs font-bold tracking-widest text-white/60 uppercase">
              Phase {String(phaseNum).padStart(2, '0')}
            </span>
            {profile?.industry && (
              <span className="text-xs font-medium text-white/60 bg-white/10 px-2 py-0.5 rounded-full">
                {industryLabels[profile.industry] ?? profile.industry}
              </span>
            )}
            {profile?.role && (
              <span className="text-xs font-medium text-white/60 bg-white/10 px-2 py-0.5 rounded-full">
                {roleLabels[profile.role] ?? profile.role}
              </span>
            )}
          </div>
          <h1 className="text-3xl font-bold text-white mb-1">{title}</h1>
          <p className="text-white/60 text-sm">{subtitle}</p>
        </div>

        {/* Content summary pills */}
        {!loading && (
          <div className="flex gap-3 mt-5">
            {Object.entries(grouped).map(([type, list]) => list.length > 0 && (
              <button
                key={type}
                onClick={() => setActiveType(type)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold transition-all ${
                  activeType === type
                    ? 'bg-white text-slate-800 shadow'
                    : 'bg-white/15 text-white hover:bg-white/25'
                }`}
              >
                <span>{typeConfig[type].icon}</span>
                {typeConfig[type].label}
                <span className={`ml-1 rounded-full w-4 h-4 flex items-center justify-center text-[10px] font-bold ${
                  activeType === type ? 'bg-slate-200 text-slate-600' : 'bg-white/20 text-white'
                }`}>{list.length}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Content area */}
      <div className="max-w-4xl px-8 py-8">
        {loading ? (
          <div className="space-y-3">
            {[1, 2, 3].map(n => (
              <div key={n} className="h-28 bg-white rounded-2xl border border-slate-100 animate-pulse" />
            ))}
          </div>
        ) : items.length === 0 ? (
          <div className="text-center py-16 bg-white rounded-2xl border border-slate-100">
            <p className="text-3xl mb-3">📭</p>
            <p className="text-slate-500 text-sm">No content has been added for this phase yet.</p>
            <p className="text-slate-400 text-xs mt-1">Admins can add content in Platform Admin → Content Manager.</p>
          </div>
        ) : (
          <>
            {/* Active type section */}
            {tabs.includes(activeType) && (
              <div>
                <div className="flex items-center gap-2 mb-4">
                  <span className="text-lg">{typeConfig[activeType].icon}</span>
                  <h2 className="font-bold text-slate-800">{typeConfig[activeType].label}</h2>
                  <span className="text-xs text-slate-400">({grouped[activeType].length})</span>
                </div>

                <div className="space-y-3">
                  {grouped[activeType].map(item => (
                    <ContentCard key={item.id} item={item} profile={profile} typeCfg={typeConfig[activeType]} />
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}

function ContentCard({ item, profile, typeCfg }) {
  const [expanded, setExpanded] = useState(false)

  const isIndustrySpecific = item.industry !== null
  const isRoleSpecific     = item.role !== null

  return (
    <div
      className={`bg-white border rounded-2xl overflow-hidden transition-shadow hover:shadow-md ${
        isIndustrySpecific || isRoleSpecific ? 'border-slate-200' : 'border-slate-100'
      }`}
    >
      <div
        className="flex items-start gap-4 p-5 cursor-pointer"
        onClick={() => setExpanded(!expanded)}
      >
        {/* Icon */}
        <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 text-base ${typeCfg.color}`}>
          {typeCfg.icon}
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-1.5 mb-1">
            <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${typeCfg.badge}`}>
              {item.content_type}
            </span>
            {isIndustrySpecific && (
              <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-100">
                {industryLabels[item.industry] ?? item.industry}
              </span>
            )}
            {isRoleSpecific && (
              <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-slate-100 text-slate-600">
                {roleLabels[item.role] ?? item.role}
              </span>
            )}
          </div>
          <p className="font-semibold text-slate-800 text-sm">{item.title}</p>
          {!expanded && item.description && (
            <p className="text-xs text-slate-400 mt-0.5 line-clamp-1">{item.description}</p>
          )}
        </div>

        {/* Expand arrow */}
        <span className={`text-slate-300 transition-transform shrink-0 mt-1 ${expanded ? 'rotate-180' : ''}`}>▼</span>
      </div>

      {/* Expanded description */}
      {expanded && item.description && (
        <div className="px-5 pb-5 -mt-2">
          <div className="bg-slate-50 rounded-xl p-4 border border-slate-100">
            <p className="text-sm text-slate-600 leading-relaxed">{item.description}</p>
          </div>
          <div className="flex gap-3 mt-3">
            <button className="text-xs font-semibold text-white bg-[#1F4E79] px-4 py-2 rounded-lg hover:bg-[#163a5c] transition-colors">
              Start this {item.content_type} →
            </button>
            <button className="text-xs font-semibold text-slate-500 border border-slate-200 px-4 py-2 rounded-lg hover:border-slate-300 transition-colors">
              Save for later
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
