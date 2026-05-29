import { useNavigate } from 'react-router-dom'
import { useState } from 'react'
import { useOnboarding } from '../../context/OnboardingContext'

const roles = [
  {
    id: 'po',
    label: 'Product Owner',
    icon: '🔷',
    desc: 'Vision, requirements & acceptance criteria',
    detail: 'Owns product vision, defines change requirements, manages product stakeholders.',
  },
  {
    id: 'cm',
    label: 'Change Manager',
    icon: '🔶',
    desc: 'People, stakeholders & adoption',
    detail: 'Leads stakeholder engagement, builds comms plans, drives adoption and reinforcement.',
  },
  {
    id: 'pm',
    label: 'Project Manager',
    icon: '🟩',
    desc: 'Governance, timeline & risk',
    detail: 'Owns project plan, manages risks and dependencies, tracks delivery milestones.',
  },
]

const borderColor = { po: 'border-[#2E75B6]', cm: 'border-[#E8913A]', pm: 'border-[#70AD47]' }

export default function RoleSelect() {
  const { setRole } = useOnboarding()
  const navigate    = useNavigate()
  const [selected, setSelected] = useState(null)

  function handleContinue() {
    if (!selected) return
    setRole(selected)
    navigate('/onboarding/industry')
  }

  return (
    <div className="min-h-screen bg-white flex flex-col items-center justify-center px-4 py-12">
      <p className="text-[#1F4E79] font-bold tracking-widest text-sm mb-8">CHANGEFLOW</p>

      {/* Step indicator */}
      <div className="flex items-center gap-2 mb-8">
        {[1, 2, 3].map(n => (
          <div key={n} className="flex items-center gap-2">
            <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-semibold ${n === 1 ? 'bg-[#1F4E79] text-white' : 'border border-slate-300 text-slate-400'}`}>
              {n}
            </div>
            {n < 3 && <div className="w-10 h-px bg-slate-200" />}
          </div>
        ))}
      </div>

      <h1 className="text-2xl font-bold text-slate-800 text-center mb-2">What's your role?</h1>
      <p className="text-slate-500 text-sm text-center mb-8 max-w-sm">
        Your role shapes every piece of content, exercise, and output you'll see across all 5 phases.
      </p>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 w-full max-w-2xl mb-8">
        {roles.map(r => (
          <button
            key={r.id}
            onClick={() => setSelected(r.id)}
            className={`text-left p-5 rounded-xl border-2 transition-all ${
              selected === r.id
                ? `${borderColor[r.id]} bg-slate-50`
                : 'border-slate-200 hover:border-slate-300'
            }`}
          >
            <div className="text-2xl mb-3">{r.icon}</div>
            <p className="font-semibold text-slate-800 mb-1">{r.label}</p>
            <p className="text-xs text-slate-500 mb-2">{r.desc}</p>
            <p className="text-xs text-slate-400 leading-relaxed">{r.detail}</p>
          </button>
        ))}
      </div>

      <button
        onClick={handleContinue}
        disabled={!selected}
        className={`px-8 py-3 rounded-lg font-semibold text-sm transition-colors ${
          selected
            ? 'bg-[#E8913A] text-white hover:bg-[#d07e2e]'
            : 'bg-slate-200 text-slate-400 cursor-not-allowed'
        }`}
      >
        Continue
      </button>
    </div>
  )
}
