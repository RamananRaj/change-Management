import { Link } from 'react-router-dom'
import { useOnboarding } from '../context/OnboardingContext'

const roleLabels = { po: 'Product Owner', cm: 'Change Manager', pm: 'Project Manager' }

const phases = [
  { num: '01', name: 'Diagnose', path: '/phases/diagnose', status: 'active',    desc: 'Understand where you are before you move' },
  { num: '02', name: 'Design',   path: '/phases/design',   status: 'locked',   desc: 'Build the blueprint for successful change' },
  { num: '03', name: 'Engage',   path: '/phases/engage',   status: 'locked',   desc: 'Bring people with you, not behind you' },
  { num: '04', name: 'Embed',    path: '/phases/embed',    status: 'locked',   desc: 'Make the change stick' },
  { num: '05', name: 'Evaluate', path: '/phases/evaluate', status: 'locked',   desc: 'Know what worked — and build on it' },
]

export default function Dashboard() {
  const { role, industry } = useOnboarding()

  return (
    <div className="p-8 max-w-3xl">
      {/* Header */}
      <div className="mb-8">
        <p className="text-xs text-slate-400 uppercase tracking-widest font-semibold mb-1">Dashboard</p>
        <h1 className="text-2xl font-bold text-slate-800 mb-1">Welcome back</h1>
        {role && (
          <p className="text-sm text-slate-500">
            {roleLabels[role]} · {industry?.replace(/-/g, ' ')}
          </p>
        )}
      </div>

      {/* Phase cards */}
      <div className="space-y-3">
        {phases.map(ph => (
          <div
            key={ph.num}
            className={`flex items-center gap-5 p-5 rounded-xl border ${
              ph.status === 'active'
                ? 'border-[#1F4E79] bg-[#1F4E79]/5'
                : 'border-slate-200 bg-white opacity-60'
            }`}
          >
            <div className={`text-2xl font-bold shrink-0 ${ph.status === 'active' ? 'text-[#1F4E79]' : 'text-slate-300'}`}>
              {ph.num}
            </div>
            <div className="flex-1">
              <p className={`font-semibold ${ph.status === 'active' ? 'text-slate-800' : 'text-slate-400'}`}>{ph.name}</p>
              <p className="text-xs text-slate-400 mt-0.5">{ph.desc}</p>
            </div>
            {ph.status === 'active' ? (
              <Link
                to={ph.path}
                className="shrink-0 bg-[#1F4E79] text-white text-xs font-semibold px-4 py-2 rounded-lg hover:bg-[#163a5c] transition-colors"
              >
                Begin →
              </Link>
            ) : (
              <span className="shrink-0 text-xs text-slate-300 border border-slate-200 px-3 py-1.5 rounded-lg">
                Locked
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
