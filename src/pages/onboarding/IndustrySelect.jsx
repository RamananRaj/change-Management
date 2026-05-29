import { useNavigate } from 'react-router-dom'
import { useState, useEffect } from 'react'
import { useOnboarding } from '../../context/OnboardingContext'
import { supabase } from '../../lib/supabase'

export default function IndustrySelect() {
  const { setIndustry } = useOnboarding()
  const navigate        = useNavigate()
  const [selected,    setSelected]    = useState(null)
  const [industries,  setIndustries]  = useState([])
  const [loading,     setLoading]     = useState(true)

  useEffect(() => {
    async function fetchIndustries() {
      const { data } = await supabase
        .from('industries')
        .select('*')
        .eq('is_active', true)
        .order('sort_order', { ascending: true })
      setIndustries(data ?? [])
      setLoading(false)
    }
    fetchIndustries()
  }, [])

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

      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 w-full max-w-lg mb-8">
          {[1, 2, 3, 4, 5, 6].map(n => (
            <div key={n} className="h-16 bg-slate-100 rounded-xl animate-pulse" />
          ))}
        </div>
      ) : (
        <div className={`grid gap-3 w-full max-w-lg mb-8 ${
          industries.length <= 2 ? 'grid-cols-1' :
          industries.length <= 4 ? 'grid-cols-1 sm:grid-cols-2' :
          'grid-cols-1 sm:grid-cols-2'
        }`}>
          {industries.map(ind => (
            <button
              key={ind.code}
              onClick={() => setSelected(ind.code)}
              className={`flex items-center gap-3 px-4 py-3 rounded-xl border-2 text-left transition-all ${
                selected === ind.code
                  ? 'border-[#1F4E79] bg-slate-50 shadow-sm'
                  : 'border-slate-200 hover:border-slate-300'
              }`}
            >
              <span className="text-2xl shrink-0">{ind.icon}</span>
              <div>
                <p className="font-semibold text-slate-800 text-sm">{ind.label}</p>
                {ind.detail && <p className="text-xs text-slate-400">{ind.detail}</p>}
              </div>
            </button>
          ))}
        </div>
      )}

      <div className="flex gap-3">
        <button
          onClick={() => navigate('/onboarding/role')}
          className="px-6 py-3 rounded-lg text-sm text-slate-500 border border-slate-200 hover:bg-slate-50 transition-colors"
        >
          ← Back
        </button>
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
    </div>
  )
}
