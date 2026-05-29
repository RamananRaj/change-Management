import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useOnboarding } from '../../context/OnboardingContext'
import { useAuth } from '../../context/AuthContext'
import { supabase } from '../../lib/supabase'

const roleLabels = {
  po: 'Product Owner',
  cm: 'Change Manager',
  pm: 'Project Manager',
}

const industryLabels = {
  'financial-services': '🏦 Financial Services',
  'healthcare':         '🏥 Healthcare',
  'utilities-energy':   '⚡ Utilities & Energy',
  'telecommunications': '📡 Telecommunications',
  'manufacturing':      '🏭 Manufacturing',
  'public-sector':      '🏛 Public Sector',
  'retail-consumer':    '🛒 Retail & Consumer',
}

const phases = ['Diagnose', 'Design', 'Engage', 'Embed', 'Evaluate']

export default function Confirm() {
  const { role, industry }    = useOnboarding()
  const { user, fetchProfile } = useAuth()
  const navigate              = useNavigate()
  const [saving, setSaving]   = useState(false)
  const [error, setError]     = useState(null)

  async function handleStart() {
    setSaving(true)
    setError(null)

    // Save role + industry to profiles table, mark onboarding done
    const { error: profileError } = await supabase
      .from('profiles')
      .update({ role, industry, onboarding_done: true })
      .eq('id', user.id)

    if (profileError) {
      setError('Could not save your setup. Please try again.')
      setSaving(false)
      return
    }

    // Create the first project for this user
    const { data: project, error: projectError } = await supabase
      .from('projects')
      .insert({ user_id: user.id, name: 'My First Project', role, industry, current_phase: 1 })
      .select()
      .single()

    if (projectError) {
      setError('Could not create your project. Please try again.')
      setSaving(false)
      return
    }

    // Seed phase 1 as active, phases 2–5 as locked
    const phaseRows = [1,2,3,4,5].map(n => ({
      project_id:   project.id,
      phase_number: n,
      status:       n === 1 ? 'active' : 'locked',
    }))
    await supabase.from('project_phases').insert(phaseRows)

    // Refresh the profile in context
    await fetchProfile(user.id)

    navigate('/dashboard')
  }

  return (
    <div className="min-h-screen bg-white flex flex-col items-center justify-center px-4 py-12">
      <p className="text-[#1F4E79] font-bold tracking-widest text-sm mb-8">CHANGEFLOW</p>

      {/* Step indicator */}
      <div className="flex items-center gap-2 mb-8">
        {[1, 2, 3].map(n => (
          <div key={n} className="flex items-center gap-2">
            <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-semibold ${
              n < 3 ? 'bg-[#E8913A] text-white' : 'bg-[#1F4E79] text-white'
            }`}>
              {n < 3 ? '✓' : n}
            </div>
            {n < 3 && <div className="w-10 h-px bg-[#E8913A]" />}
          </div>
        ))}
      </div>

      {/* Confirm card */}
      <div className="bg-[#1F4E79] rounded-2xl p-8 text-center w-full max-w-md mb-6">
        <p className="text-white font-semibold text-lg mb-2">We've configured ChangeFlow for you</p>
        <p className="text-[#9fc8e8] text-sm mb-5">
          Every phase, tool, output template, and AI coach is tuned to your setup.
        </p>
        <div className="flex justify-center gap-3">
          <span className="bg-[#E8913A]/70 text-white text-xs font-medium px-4 py-1.5 rounded-full border border-white/20">
            {roleLabels[role] ?? '—'}
          </span>
          <span className="bg-white/15 text-white text-xs font-medium px-4 py-1.5 rounded-full border border-white/20">
            {industryLabels[industry] ?? '—'}
          </span>
        </div>
      </div>

      {/* Phase preview */}
      <div className="flex w-full max-w-md mb-6">
        {phases.map((ph, i) => (
          <div key={ph} className={`flex-1 text-center py-2 border-t-2 ${i === 0 ? 'border-[#1F4E79]' : 'border-slate-200'}`}>
            <p className="text-[10px] text-slate-400">0{i + 1}</p>
            <p className={`text-xs font-medium ${i === 0 ? 'text-[#1F4E79]' : 'text-slate-500'}`}>{ph}</p>
          </div>
        ))}
      </div>

      {/* Feature highlights */}
      <div className="grid grid-cols-2 gap-3 w-full max-w-md mb-8">
        {[
          ['📋', 'Industry-specific exercises & outputs'],
          ['🏆', 'Role-track certification (CCP)'],
          ['🤖', 'AI Change Coach, tuned to your context'],
          ['📄', 'Output templates, ready to download'],
        ].map(([icon, text]) => (
          <div key={text} className="flex items-start gap-2 bg-slate-50 rounded-lg p-3">
            <span className="text-sm">{icon}</span>
            <p className="text-xs text-slate-500 leading-relaxed">{text}</p>
          </div>
        ))}
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-600 mb-4 w-full max-w-md">
          {error}
        </div>
      )}

      <button
        onClick={handleStart}
        disabled={saving}
        className="bg-[#E8913A] text-white font-semibold px-10 py-3 rounded-lg hover:bg-[#d07e2e] transition-colors text-sm disabled:opacity-60 disabled:cursor-not-allowed"
      >
        {saving ? 'Setting up your account…' : 'Start Phase 1: Diagnose →'}
      </button>

      <button
        onClick={() => navigate('/onboarding/industry')}
        className="mt-3 text-xs text-slate-400 hover:text-slate-600"
      >
        ← Change industry
      </button>
    </div>
  )
}
