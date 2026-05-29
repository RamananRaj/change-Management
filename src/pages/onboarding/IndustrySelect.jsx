import { useNavigate } from 'react-router-dom'
import { useState } from 'react'
import { useOnboarding } from '../../context/OnboardingContext'

const industries = [
  { id: 'financial-services', icon: '🏦', label: 'Financial Services',  fw: 'ADKAR + Regulatory' },
  { id: 'healthcare',         icon: '🏥', label: 'Healthcare',           fw: 'ADKAR + Clinical Gov.' },
  { id: 'utilities-energy',   icon: '⚡', label: 'Utilities & Energy',   fw: 'Kotter + Safety + ADKAR' },
  { id: 'telecommunications', icon: '📡', label: 'Telecommunications',   fw: 'Agile Change + ADKAR' },
  { id: 'manufacturing',      icon: '🏭', label: 'Manufacturing',         fw: 'Lewin + ADKAR + Lean' },
  { id: 'public-sector',      icon: '🏛', label: 'Public Sector',         fw: 'ADKAR + MSP/PRINCE2' },
  { id: 'retail-consumer',    icon: '🛒', label: 'Retail & Consumer',     fw: 'Agile + ADKAR' },
]

export default function IndustrySelect() {
  const { setIndustry } = useOnboarding()
  const navigate        = useNavigate()
  const [selected, setSelected] = useState(null)

  function handleContinue() {
    if (!selected) return
    setIndustry(selected)
    navigate('/onboarding/confirm')
  }

  return (
    <div className="min-h-screen bg-white flex flex-col items-center justify-center px-4 py-12">
      <p className="text-[#1F4E79] font-bold tracking-widest text-sm mb-8">CHANGEFLOW</p>

      {/* Step indicator */}
      <div className="flex items-center gap-2 mb-8">
        {[1, 2, 3].map(n => (
          <div key={n} className="flex items-center gap-2">
            <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-semibold ${
              n === 1 ? 'bg-[#E8913A] text-white'
              : n === 2 ? 'bg-[#1F4E79] text-white'
              : 'border border-slate-300 text-slate-400'
            }`}>
              {n === 1 ? '✓' : n}
            </div>
            {n < 3 && <div className={`w-10 h-px ${n === 1 ? 'bg-[#E8913A]' : 'bg-slate-200'}`} />}
          </div>
        ))}
      </div>

      <h1 className="text-2xl font-bold text-slate-800 text-center mb-2">Select your industry</h1>
      <p className="text-slate-500 text-sm text-center mb-8 max-w-sm">
        This configures your entire platform — frameworks, terminology, tools, and certifications.
      </p>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 w-full max-w-lg mb-8">
        {industries.map(ind => (
          <button
            key={ind.id}
            onClick={() => setSelected(ind.id)}
            className={`flex items-center gap-3 px-4 py-3 rounded-xl border-2 text-left transition-all ${
              selected === ind.id
                ? 'border-[#1F4E79] bg-slate-50'
                : 'border-slate-200 hover:border-slate-300'
            }`}
          >
            <span className="text-2xl shrink-0">{ind.icon}</span>
            <div>
              <p className="font-semibold text-slate-800 text-sm">{ind.label}</p>
              <p className="text-xs text-slate-400">{ind.fw}</p>
            </div>
          </button>
        ))}
      </div>

      <div className="flex gap-3">
        <button
          onClick={() => navigate('/onboarding/role')}
          className="px-6 py-3 rounded-lg text-sm text-slate-500 border border-slate-200 hover:bg-slate-50 transition-colors"
        >
          ← Back
        </button>
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
    </div>
  )
}
