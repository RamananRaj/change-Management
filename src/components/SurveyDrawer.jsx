import { useState, useEffect } from 'react'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../lib/supabase'

function calcQuestionScore(question, answer) {
  if (answer === undefined || answer === null || answer === '') return null
  if (question.question_type === 'rating')        return Number(answer) || null
  if (question.question_type === 'yes_no')        return answer === 'yes' ? 5 : answer === 'no' ? 1 : null
  if (question.question_type === 'single_choice') {
    const opt = (question.options ?? []).find(o => o.label === answer)
    return opt ? Number(opt.score) : null
  }
  return null
}

function calcTotalScore(questions, answers) {
  const scores = questions
    .map(q => calcQuestionScore(q, answers?.[q.id]))
    .filter(s => s !== null)
  if (scores.length === 0) return null
  return scores.reduce((a, b) => a + b, 0) / scores.length
}

// ── Question Input components ────────────────────────────────────────────────

function RatingQuestion({ value, onChange, disabled }) {
  const val = Number(value) || 0
  return (
    <div className="flex gap-1.5 mt-2">
      {[1,2,3,4,5].map(n => (
        <button
          key={n}
          type="button"
          disabled={disabled}
          onClick={() => onChange(val === n ? 0 : n)}
          className={`text-2xl leading-none transition-colors ${disabled ? 'cursor-default' : 'cursor-pointer hover:scale-110'} ${n <= val ? 'text-[#E8913A]' : 'text-slate-200'}`}
        >★</button>
      ))}
      {val > 0 && <span className="text-xs text-slate-400 self-center ml-1">{val}/5</span>}
    </div>
  )
}

function YesNoQuestion({ value, onChange, disabled }) {
  return (
    <div className="flex gap-3 mt-2">
      <button
        type="button"
        disabled={disabled}
        onClick={() => onChange(value === 'yes' ? '' : 'yes')}
        className={`px-6 py-2 rounded-xl text-sm font-semibold border-2 transition-all ${
          value === 'yes'
            ? 'bg-green-500 border-green-500 text-white'
            : 'border-slate-200 text-slate-600 hover:border-green-300 hover:bg-green-50'
        } ${disabled ? 'cursor-default opacity-70' : 'cursor-pointer'}`}
      >
        ✓ Yes
      </button>
      <button
        type="button"
        disabled={disabled}
        onClick={() => onChange(value === 'no' ? '' : 'no')}
        className={`px-6 py-2 rounded-xl text-sm font-semibold border-2 transition-all ${
          value === 'no'
            ? 'bg-red-500 border-red-500 text-white'
            : 'border-slate-200 text-slate-600 hover:border-red-300 hover:bg-red-50'
        } ${disabled ? 'cursor-default opacity-70' : 'cursor-pointer'}`}
      >
        ✗ No
      </button>
    </div>
  )
}

function SingleChoiceQuestion({ options, value, onChange, disabled }) {
  return (
    <div className="flex flex-col gap-2 mt-2">
      {(options ?? []).map(opt => (
        <button
          key={opt.label}
          type="button"
          disabled={disabled}
          onClick={() => onChange(value === opt.label ? '' : opt.label)}
          className={`text-left px-4 py-2.5 rounded-xl text-sm border-2 transition-all ${
            value === opt.label
              ? 'bg-[#1F4E79] border-[#1F4E79] text-white font-semibold'
              : 'border-slate-200 text-slate-700 hover:border-[#1F4E79]/40 hover:bg-[#1F4E79]/5'
          } ${disabled ? 'cursor-default' : 'cursor-pointer'}`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export default function SurveyDrawer({ survey, onClose, onComplete }) {
  const { user } = useAuth()
  const [questions,  setQuestions]  = useState([])
  const [answers,    setAnswers]    = useState({})
  const [loading,    setLoading]    = useState(true)
  const [saving,     setSaving]     = useState(false)
  const [saved,      setSaved]      = useState(false)
  const [submitted,  setSubmitted]  = useState(false)

  useEffect(() => {
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = '' }
  }, [])

  useEffect(() => { loadSurvey() }, [survey.id])

  async function loadSurvey() {
    setLoading(true)
    const [{ data: qs }, { data: resp }] = await Promise.all([
      supabase.from('survey_questions').select('*').eq('survey_id', survey.id).neq('is_active', false).order('sort_order'),
      supabase.from('survey_responses').select('*').eq('survey_id', survey.id).eq('user_id', user.id).single(),
    ])
    setQuestions(qs ?? [])
    if (resp) {
      setAnswers(resp.answers ?? {})
      setSubmitted(!!resp.submitted_at)
    }
    setLoading(false)
  }

  function setAnswer(questionId, value) {
    setAnswers(prev => ({ ...prev, [questionId]: value }))
  }

  async function saveProgress() {
    setSaving(true)
    const score = calcTotalScore(questions, answers)
    await supabase.from('survey_responses').upsert({
      survey_id:  survey.id,
      user_id:    user.id,
      answers,
      score,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'survey_id,user_id' })
    setSaving(false)
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  async function submitSurvey() {
    setSaving(true)
    const score = calcTotalScore(questions, answers)
    await supabase.from('survey_responses').upsert({
      survey_id:    survey.id,
      user_id:      user.id,
      answers,
      score,
      submitted_at: new Date().toISOString(),
      updated_at:   new Date().toISOString(),
    }, { onConflict: 'survey_id,user_id' })
    setSubmitted(true)
    setSaving(false)
    onComplete?.()
    onClose()
  }

  const allRequired = questions
    .filter(q => q.is_required)
    .every(q => answers[q.id] !== undefined && answers[q.id] !== '' && answers[q.id] !== null)

  const answeredCount = questions.filter(q => answers[q.id] !== undefined && answers[q.id] !== '' && answers[q.id] !== null).length

  return (
    <>
      <div className="fixed inset-0 bg-black/50 z-40" onClick={onClose} />

      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 pointer-events-none">
        <div className="relative bg-white rounded-2xl shadow-2xl flex flex-col pointer-events-auto w-full max-w-2xl" style={{ maxHeight: '92vh' }}>

          {/* Header */}
          <div className="flex items-start justify-between px-6 py-5 border-b border-slate-100 shrink-0">
            <div className="flex-1 min-w-0 pr-4">
              <div className="flex items-center gap-2 mb-1.5">
                <span className="text-lg">📊</span>
                <span className="text-xs font-semibold text-slate-400 uppercase tracking-widest">Survey</span>
                {submitted && (
                  <span className="text-xs font-semibold bg-green-100 text-green-700 px-2 py-0.5 rounded-full">✓ Submitted</span>
                )}
              </div>
              <h2 className="font-bold text-slate-800 text-lg leading-snug">{survey.title}</h2>
              {survey.description && (
                <p className="text-xs text-slate-500 mt-1">{survey.description}</p>
              )}
            </div>
            <button onClick={onClose}
              className="w-8 h-8 rounded-full bg-slate-100 hover:bg-slate-200 flex items-center justify-center text-slate-500 transition-colors shrink-0">
              ✕
            </button>
          </div>

          {/* Progress bar */}
          {!loading && questions.length > 0 && (
            <div className="px-6 pt-3 shrink-0">
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs text-slate-400">{answeredCount} of {questions.length} answered</span>
                <span className="text-xs text-slate-400">{Math.round((answeredCount / questions.length) * 100)}%</span>
              </div>
              <div className="w-full bg-slate-100 rounded-full h-1.5">
                <div
                  className="bg-[#1F4E79] h-1.5 rounded-full transition-all"
                  style={{ width: `${(answeredCount / questions.length) * 100}%` }}
                />
              </div>
            </div>
          )}

          {/* Scrollable questions */}
          <div className="flex-1 overflow-y-auto px-6 py-5">
            {loading ? (
              <div className="space-y-4">
                {[1,2,3].map(n => <div key={n} className="h-20 bg-slate-100 rounded-xl animate-pulse" />)}
              </div>
            ) : submitted ? (
              <div className="text-center py-12">
                <p className="text-4xl mb-3">✅</p>
                <p className="font-semibold text-slate-800 mb-1">Survey submitted</p>
                <p className="text-sm text-slate-500">Thank you — your responses have been recorded.</p>
              </div>
            ) : (
              <div className="space-y-6">
                {questions.map((q, idx) => (
                  <div key={q.id} className="bg-slate-50 rounded-2xl p-4 border border-slate-100">
                    <p className="text-sm font-semibold text-slate-800 leading-snug">
                      <span className="text-[#1F4E79] mr-2">{idx + 1}.</span>
                      {q.question_text}
                      {q.is_required && <span className="text-[#E8913A] ml-1">*</span>}
                    </p>

                    {q.question_type === 'rating' && (
                      <RatingQuestion
                        value={answers[q.id]}
                        onChange={val => setAnswer(q.id, val)}
                        disabled={submitted}
                      />
                    )}
                    {q.question_type === 'yes_no' && (
                      <YesNoQuestion
                        value={answers[q.id]}
                        onChange={val => setAnswer(q.id, val)}
                        disabled={submitted}
                      />
                    )}
                    {q.question_type === 'single_choice' && (
                      <SingleChoiceQuestion
                        options={q.options}
                        value={answers[q.id]}
                        onChange={val => setAnswer(q.id, val)}
                        disabled={submitted}
                      />
                    )}
                    {q.question_type === 'text' && (
                      <textarea
                        value={answers[q.id] ?? ''}
                        onChange={e => setAnswer(q.id, e.target.value)}
                        disabled={submitted}
                        placeholder="Your response…"
                        rows={3}
                        className="w-full mt-2 border border-slate-200 rounded-xl px-3 py-2 text-sm text-slate-700 resize-none focus:outline-none focus:border-[#1F4E79] disabled:bg-slate-50 disabled:text-slate-400"
                      />
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Footer */}
          {!submitted && !loading && (
            <div className="px-6 py-4 border-t border-slate-100 bg-white shrink-0">
              <div className="flex gap-3">
                <button
                  onClick={saveProgress}
                  disabled={saving}
                  className="flex-1 text-sm font-semibold text-[#1F4E79] border border-[#1F4E79]/30 px-4 py-2.5 rounded-xl hover:bg-[#1F4E79]/5 transition-colors disabled:opacity-50"
                >
                  {saving ? 'Saving…' : saved ? '✓ Saved' : 'Save progress'}
                </button>
                <button
                  onClick={submitSurvey}
                  disabled={saving || !allRequired}
                  className="flex-1 text-sm font-bold text-white bg-[#1F4E79] px-4 py-2.5 rounded-xl hover:bg-[#163a5c] transition-colors disabled:opacity-50"
                  title={!allRequired ? 'Answer all required questions first' : ''}
                >
                  {saving ? 'Submitting…' : 'Submit Survey ✓'}
                </button>
              </div>
              {!allRequired && (
                <p className="text-[11px] text-slate-400 text-center mt-2">
                  Answer all required (*) questions to submit.
                </p>
              )}
            </div>
          )}
        </div>
      </div>
    </>
  )
}
