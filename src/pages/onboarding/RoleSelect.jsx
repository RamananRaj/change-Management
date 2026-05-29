import { useNavigate } from 'react-router-dom'
import { useState, useEffect } from 'react'
import { useOnboarding } from '../../context/OnboardingContext'
import { supabase } from '../../lib/supabase'

const borderColors = [
  'border-[#1F4E79]', 'border-[#E8913A]', 'border-[#70AD47]',
  'border-[#2E75B6]', 'border-[#9B59B6]', 'border-[#E74C3C]',
]

export default function RoleSelect() {
  const { setRole } = useOnboarding()
  const navigate    = useNavigate()
  const [selected,  setSelected]  = useState(null)
  const [roles,     setRoles]     = useState([])
  const [loading,   setLoading]   = useState(true)

  useEffect(() => {
    async function fetchRoles() {
      const { data } = await supabase
        .from('roles')
        .select('*')
        .eq('is_active', true)
        .order('sort_order', { ascending: true })
      setRoles(data ?? [])
      setLoading(false)
    }
    fetchRoles()
  }, [])

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
            <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-semibold ${
              n === 1 ? 'bg-[#1F4E79] text-white' : 'border border-slate-300 text-slate-400'
            }`}>
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

      {loading ? (
        <div className="flex gap-4 w-full max-w-2xl">
          {[1, 2, 3].map(n => (
            <div key={n} className="flex-1 h-40 bg-slate-100 rounded-xl animate-pulse" />
          ))}
        </div>
      ) : (
        <div className={`grid gap-4 w-full max-w-2xl mb-8 ${
          roles.length <= 3 ? 'grid-cols-1 md:grid-cols-3' :
          roles.length <= 4 ? 'grid-cols-2' : 'grid-cols-2 md:grid-cols-3'
        }`}>
          {roles.map((r, i) => (
            <button
              key={r.code}
              onClick={() => setSelected(r.code)}
              className={`text-left p-5 rounded-xl border-2 transition-all ${
                selected === r.code
                  ? `${borderColors[i % borderColors.length]} bg-slate-50 shadow-sm`
                  : 'border-slate-200 hover:border-slate-300'
              }`}
            >
              <div className="text-2xl mb-3">{r.icon ?? '🔷'}</div>
              <p className="font-semibold text-slate-800 mb-1">{r.label}</p>
              {r.description && <p className="text-xs text-slate-500 mb-2">{r.description}</p>}
              {r.detail && <p className="text-xs text-slate-400 leading-relaxed">{r.detail}</p>}
            </button>
          ))}
        </div>
      )}

      <button
        onClick={handleContinue}
        disabled={!selected || loading}
        className={`px-8 py-3 rounded-lg font-semibold text-sm transition-colors ${
          selected && !loading
            ? 'bg-[#E8913A] text-white hover:bg-[#d07e2e]'
            : 'bg-slate-200 text-slate-400 cursor-not-allowed'
        }`}
      >
        Continue
      </button>
    </div>
  )
}
