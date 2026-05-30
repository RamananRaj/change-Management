import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'

const PHASES = [
  { num: 1, label: '01 Diagnose' },
  { num: 2, label: '02 Design' },
  { num: 3, label: '03 Engage' },
  { num: 4, label: '04 Embed' },
  { num: 5, label: '05 Evaluate' },
]

const QUESTION_TYPES = [
  { value: 'rating',        label: 'Rating (1–5 stars)' },
  { value: 'yes_no',        label: 'Yes / No' },
  { value: 'single_choice', label: 'Single Choice (scored)' },
  { value: 'text',          label: 'Text (qualitative, no score)' },
]

const RAG_COLORS = {
  green:  'bg-green-100 text-green-700',
  amber:  'bg-amber-100 text-amber-700',
  red:    'bg-red-100 text-red-700',
}

const emptySurveyForm = {
  title:              '',
  description:        '',
  phase_number:       1,
  target_role:        'change_manager',
  rag_green_threshold: 3.5,
  rag_amber_threshold: 2.5,
  is_active:          true,
  sort_order:         0,
}

function makeQuestion() {
  return { _id: Math.random().toString(36).slice(2), question_text: '', question_type: 'rating', is_required: false, options: [] }
}

function makeOption() {
  return { _optId: Math.random().toString(36).slice(2), label: '', score: 3 }
}

// Score a single answer for a question
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

function getRag(score, survey) {
  if (score === null || score === undefined) return null
  if (score >= Number(survey.rag_green_threshold)) return 'green'
  if (score >= Number(survey.rag_amber_threshold)) return 'amber'
  return 'red'
}

function RagBadge({ score, survey }) {
  const rag = getRag(score, survey)
  if (!rag) return <span className="text-slate-300 text-xs">—</span>
  const label = { green: '● Green', amber: '● Amber', red: '● Red' }[rag]
  return <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${RAG_COLORS[rag]}`}>{label}</span>
}

export default function AdminSurveys({ roles }) {
  const [surveys,          setSurveys]          = useState([])
  const [loading,          setLoading]          = useState(false)
  const [showForm,         setShowForm]         = useState(false)
  const [surveyForm,       setSurveyForm]       = useState(emptySurveyForm)
  const [formQuestions,    setFormQuestions]    = useState([makeQuestion()])
  const [editId,           setEditId]           = useState(null)
  const [saving,           setSaving]           = useState(false)
  const [formError,        setFormError]        = useState(null)

  // Results view
  const [resultsFor,       setResultsFor]       = useState(null)
  const [resultsQuestions, setResultsQuestions] = useState([])
  const [resultsResponses, setResultsResponses] = useState([])
  const [resultsLoading,   setResultsLoading]   = useState(false)
  const [generatingInsight,setGeneratingInsight]= useState(false)

  useEffect(() => { fetchSurveys() }, [])

  async function fetchSurveys() {
    setLoading(true)
    const { data } = await supabase.from('surveys').select('*').order('phase_number').order('sort_order')
    setSurveys(data ?? [])
    setLoading(false)
  }

  function openNewSurvey() {
    setSurveyForm({ ...emptySurveyForm, sort_order: (surveys.length + 1) * 10 })
    setFormQuestions([makeQuestion()])
    setEditId(null)
    setFormError(null)
    setShowForm(true)
  }

  async function openEditSurvey(s) {
    setSurveyForm({
      title:               s.title,
      description:         s.description ?? '',
      phase_number:        s.phase_number,
      target_role:         s.target_role ?? 'change_manager',
      rag_green_threshold: s.rag_green_threshold ?? 3.5,
      rag_amber_threshold: s.rag_amber_threshold ?? 2.5,
      is_active:           s.is_active,
      sort_order:          s.sort_order ?? 0,
    })
    const { data: qs } = await supabase
      .from('survey_questions')
      .select('*')
      .eq('survey_id', s.id)
      .order('sort_order')
    setFormQuestions((qs ?? []).map(q => ({
      _id:           q.id,
      question_text: q.question_text,
      question_type: q.question_type,
      is_required:   q.is_required,
      options:       (q.options ?? []).map(o => ({ _optId: Math.random().toString(36).slice(2), ...o })),
    })))
    setEditId(s.id)
    setFormError(null)
    setShowForm(true)
  }

  async function handleSave() {
    if (!surveyForm.title.trim())          { setFormError('Title is required'); return }
    if (formQuestions.length === 0)        { setFormError('Add at least one question'); return }
    if (formQuestions.some(q => !q.question_text.trim())) { setFormError('All questions need text'); return }

    setSaving(true)
    const payload = {
      ...surveyForm,
      target_role: surveyForm.target_role || null,
    }

    let surveyId = editId
    let error

    if (editId) {
      ;({ error } = await supabase.from('surveys').update(payload).eq('id', editId))
    } else {
      const { data, error: insertErr } = await supabase.from('surveys').insert(payload).select().single()
      error = insertErr
      surveyId = data?.id
    }

    if (error) { setFormError(error.message); setSaving(false); return }

    // Replace all questions
    await supabase.from('survey_questions').delete().eq('survey_id', surveyId)
    const questionRows = formQuestions.map((q, idx) => ({
      survey_id:     surveyId,
      question_text: q.question_text.trim(),
      question_type: q.question_type,
      is_required:   q.is_required,
      options:       q.question_type === 'single_choice'
        ? q.options.map(o => ({ label: o.label, score: Number(o.score) }))
        : [],
      sort_order: idx * 10,
    }))
    await supabase.from('survey_questions').insert(questionRows)

    setSaving(false)
    setShowForm(false)
    fetchSurveys()
  }

  async function handleDelete(id) {
    if (!window.confirm('Delete this survey? All responses will also be deleted.')) return
    await supabase.from('surveys').delete().eq('id', id)
    fetchSurveys()
  }

  async function toggleActive(s) {
    await supabase.from('surveys').update({ is_active: !s.is_active }).eq('id', s.id)
    fetchSurveys()
  }

  async function viewResults(s) {
    setResultsFor(s)
    setResultsLoading(true)
    const [{ data: qs }, { data: rs }] = await Promise.all([
      supabase.from('survey_questions').select('*').eq('survey_id', s.id).order('sort_order'),
      supabase.from('survey_responses').select('*, profiles(full_name, role)').eq('survey_id', s.id),
    ])
    setResultsQuestions(qs ?? [])
    setResultsResponses(rs ?? [])
    setResultsLoading(false)
  }

  // Question builder helpers
  function addQuestion()           { setFormQuestions(prev => [...prev, makeQuestion()]) }
  function removeQuestion(id)      { setFormQuestions(prev => prev.filter(q => q._id !== id)) }
  function moveQuestion(id, dir)   {
    setFormQuestions(prev => {
      const idx = prev.findIndex(q => q._id === id)
      if (idx < 0) return prev
      const next = idx + dir
      if (next < 0 || next >= prev.length) return prev
      const arr = [...prev];
      [arr[idx], arr[next]] = [arr[next], arr[idx]]
      return arr
    })
  }
  function updateQuestion(id, field, val) {
    setFormQuestions(prev => prev.map(q => q._id === id ? { ...q, [field]: val } : q))
  }
  function addOption(qId) {
    setFormQuestions(prev => prev.map(q => q._id === qId ? { ...q, options: [...q.options, makeOption()] } : q))
  }
  function removeOption(qId, optId) {
    setFormQuestions(prev => prev.map(q => q._id === qId
      ? { ...q, options: q.options.filter(o => o._optId !== optId) }
      : q
    ))
  }
  function updateOption(qId, optId, field, val) {
    setFormQuestions(prev => prev.map(q => q._id === qId
      ? { ...q, options: q.options.map(o => o._optId === optId ? { ...o, [field]: val } : o) }
      : q
    ))
  }

  // Rule-based insight generation — no API key required
  async function generateInsight() {
    setGeneratingInsight(true)

    // Aggregate scores per question
    const qAvgs = resultsQuestions.map(q => {
      const scores = resultsResponses
        .map(r => calcQuestionScore(q, r.answers?.[q.id]))
        .filter(s => s !== null)
      const avg = scores.length > 0 ? scores.reduce((a, b) => a + b, 0) / scores.length : null
      return { ...q, avg }
    })

    const totalScores = resultsResponses.map(r => r.score).filter(s => s !== null)
    const overallAvg  = totalScores.length > 0
      ? totalScores.reduce((a, b) => a + b, 0) / totalScores.length
      : 0

    const insight = buildRuleBasedInsight(resultsFor, resultsResponses, qAvgs, overallAvg)

    await supabase.from('surveys').update({
      ai_insight:                insight,
      ai_insight_generated_at:   new Date().toISOString(),
      ai_insight_response_count: resultsResponses.length,
    }).eq('id', resultsFor.id)

    setResultsFor(prev => ({
      ...prev,
      ai_insight:                insight,
      ai_insight_generated_at:   new Date().toISOString(),
      ai_insight_response_count: resultsResponses.length,
    }))
    setSurveys(prev => prev.map(s => s.id === resultsFor.id
      ? { ...s, ai_insight: insight, ai_insight_generated_at: new Date().toISOString(), ai_insight_response_count: resultsResponses.length }
      : s
    ))

    setGeneratingInsight(false)
  }

  function buildRuleBasedInsight(survey, responses, qAvgs, overallAvg) {
    const n          = responses.length
    const greenT     = Number(survey.rag_green_threshold)
    const amberT     = Number(survey.rag_amber_threshold)
    const ragStatus  = overallAvg >= greenT ? 'Green' : overallAvg >= amberT ? 'Amber' : 'Red'
    const phaseName  = PHASES.find(p => p.num === survey.phase_number)?.label ?? `Phase ${survey.phase_number}`
    const scored     = qAvgs.filter(q => q.avg !== null).sort((a, b) => b.avg - a.avg)
    const strengths  = scored.slice(0, 2)
    const risks      = scored.slice(-2).reverse()
    const submitted  = responses.filter(r => r.submitted_at).length
    const inProgress = n - submitted

    // ── Overall readiness paragraph ──────────────────────────────────────────
    const overallLine = {
      Green: `This organisation shows strong change readiness for ${phaseName} with an overall score of ${overallAvg.toFixed(1)}/5. The data suggests a solid foundation is in place to progress through this phase with confidence.`,
      Amber: `This organisation shows moderate change readiness for ${phaseName} with an overall score of ${overallAvg.toFixed(1)}/5. There are clear strengths to build on, but targeted action is needed in specific areas before this phase is complete.`,
      Red:   `This organisation is showing low change readiness for ${phaseName} with an overall score of ${overallAvg.toFixed(1)}/5. Immediate attention is required across several areas before progressing. The change manager should consider a reset conversation with sponsors.`,
    }[ragStatus]

    // ── Participation note ───────────────────────────────────────────────────
    const participationLine = submitted === n
      ? `All ${n} respondent${n !== 1 ? 's' : ''} have submitted their responses.`
      : `${submitted} of ${n} respondent${n !== 1 ? 's have' : ' has'} submitted — ${inProgress} response${inProgress !== 1 ? 's are' : ' is'} still in progress. Consider following up to ensure full participation before drawing final conclusions.`

    // ── Strengths paragraph ──────────────────────────────────────────────────
    let strengthsPara = ''
    if (strengths.length > 0) {
      const topList = strengths.map(q => `${q.question_text} (${q.avg.toFixed(1)}/5)`).join(' and ')
      const strengthComment = overallAvg >= greenT
        ? 'These are strong assets — build on them in your engagement and communication strategy.'
        : 'These are relative strengths within an otherwise mixed picture — leverage them as anchors for your change narrative.'
      strengthsPara = `Strengths: ${topList} are the highest-scoring areas. ${strengthComment}`
    }

    // ── Risk areas paragraph ─────────────────────────────────────────────────
    let risksPara = ''
    if (risks.length > 0 && risks[0].avg !== null) {
      const riskList = risks
        .filter(q => q.avg < amberT)
        .map(q => `${q.question_text} (${q.avg.toFixed(1)}/5)`)
      const allRisksOk = risks.every(q => q.avg >= amberT)

      if (allRisksOk) {
        risksPara = `Risk Areas: No questions scored in the Red zone. Monitor ${risks.map(q => q.question_text).join(' and ')} (${risks.map(q => q.avg.toFixed(1)).join('/')}/5) — these are the lowest-scoring areas and warrant close attention as the programme progresses.`
      } else if (riskList.length > 0) {
        risksPara = `Priority Risk Areas: ${riskList.join(' and ')} scored below the Amber threshold and require immediate attention. Low scores in these areas are a strong signal that stakeholder engagement and targeted interventions are needed before moving to the next phase.`
      }
    }

    // ── Recommendations paragraph ────────────────────────────────────────────
    const recLines = []
    if (overallAvg < amberT) {
      recLines.push('Schedule a sponsor alignment session to reinforce the case for change and re-baseline expectations.')
    }
    if (risks.some(q => q.avg !== null && q.avg < amberT)) {
      recLines.push(`Address low-scoring areas with targeted interventions — workshops, one-to-one conversations, or additional communication before progressing.`)
    }
    if (inProgress > 0) {
      recLines.push(`Follow up with the ${inProgress} respondent${inProgress !== 1 ? 's' : ''} who haven't yet submitted to get a complete picture.`)
    }
    if (overallAvg >= greenT) {
      recLines.push('Use this strong readiness signal as evidence to maintain momentum and stakeholder confidence going into the next phase.')
    }
    if (recLines.length === 0) {
      recLines.push('Continue monitoring readiness as the programme progresses and consider re-running this survey at the end of the phase to measure movement.')
    }

    const recsPara = `Recommendations: ${recLines.join(' ')}`

    return [overallLine, participationLine, strengthsPara, risksPara, recsPara]
      .filter(Boolean)
      .join('\n\n')
  }

  // ── Results helpers ──────────────────────────────────────────────────────────
  const newResponsesSinceInsight = resultsFor
    ? resultsResponses.length - (resultsFor.ai_insight_response_count ?? 0)
    : 0

  const avgScore = resultsResponses.length > 0
    ? (resultsResponses.reduce((s, r) => s + (r.score ?? 0), 0) / resultsResponses.length).toFixed(1)
    : null

  // ── Render ───────────────────────────────────────────────────────────────────

  if (resultsFor) return (
    <div>
      {/* Back */}
      <button onClick={() => setResultsFor(null)} className="flex items-center gap-2 text-sm text-slate-500 hover:text-slate-700 mb-5">
        ← Back to surveys
      </button>

      <div className="flex items-start justify-between mb-6">
        <div>
          <p className="text-xs font-semibold text-slate-400 uppercase tracking-widest mb-1">Survey Results</p>
          <h2 className="text-xl font-bold text-slate-800">{resultsFor.title}</h2>
          <p className="text-xs text-slate-500 mt-1">
            Phase {resultsFor.phase_number} · {resultsFor.target_role ?? 'All roles'}
          </p>
        </div>
        {avgScore && (
          <div className="text-right">
            <p className="text-3xl font-bold text-[#1F4E79]">{avgScore}<span className="text-base text-slate-400">/5</span></p>
            <RagBadge score={Number(avgScore)} survey={resultsFor} />
            <p className="text-xs text-slate-400 mt-1">{resultsResponses.length} respondent{resultsResponses.length !== 1 ? 's' : ''}</p>
          </div>
        )}
      </div>

      {resultsLoading ? (
        <p className="text-sm text-slate-400">Loading responses…</p>
      ) : resultsResponses.length === 0 ? (
        <div className="text-center py-12 bg-slate-50 rounded-xl border border-slate-200">
          <p className="text-slate-400 text-sm">No responses yet.</p>
        </div>
      ) : (
        <>
          {/* Response table */}
          <div className="overflow-x-auto border border-slate-200 rounded-2xl mb-6">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-[#1F4E79]">
                  <th className="px-4 py-3 text-xs font-semibold text-white">Respondent</th>
                  <th className="px-4 py-3 text-xs font-semibold text-white">Score</th>
                  <th className="px-4 py-3 text-xs font-semibold text-white">RAG</th>
                  <th className="px-4 py-3 text-xs font-semibold text-white">Status</th>
                  {resultsQuestions.map(q => (
                    <th key={q.id} className="px-3 py-3 text-xs font-semibold text-white whitespace-nowrap max-w-[160px] truncate">
                      {q.question_text.length > 30 ? q.question_text.slice(0, 30) + '…' : q.question_text}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {resultsResponses.map((r, idx) => (
                  <tr key={r.id} className={`border-b border-slate-100 ${idx % 2 === 0 ? 'bg-white' : 'bg-slate-50/50'}`}>
                    <td className="px-4 py-3 text-sm text-slate-800 font-medium">
                      {r.profiles?.full_name ?? 'Unknown'}
                      <span className="text-xs text-slate-400 ml-1">({r.profiles?.role ?? '—'})</span>
                    </td>
                    <td className="px-4 py-3 text-sm font-bold text-[#1F4E79]">
                      {r.score != null ? `${Number(r.score).toFixed(1)}/5` : '—'}
                    </td>
                    <td className="px-4 py-3">
                      <RagBadge score={r.score} survey={resultsFor} />
                    </td>
                    <td className="px-4 py-3">
                      {r.submitted_at
                        ? <span className="text-xs font-semibold text-green-600 bg-green-50 px-2 py-0.5 rounded-full">Submitted</span>
                        : <span className="text-xs font-semibold text-blue-600 bg-blue-50 px-2 py-0.5 rounded-full">In Progress</span>
                      }
                    </td>
                    {resultsQuestions.map(q => {
                      const ans = r.answers?.[q.id]
                      const score = calcQuestionScore(q, ans)
                      return (
                        <td key={q.id} className="px-3 py-3 text-xs text-slate-600 max-w-[160px]">
                          {q.question_type === 'rating' && ans
                            ? <span>{'★'.repeat(Number(ans))}{'☆'.repeat(5 - Number(ans))}</span>
                            : q.question_type === 'yes_no' && ans
                            ? <span className={ans === 'yes' ? 'text-green-600 font-semibold' : 'text-red-500 font-semibold'}>{ans === 'yes' ? 'Yes' : 'No'}</span>
                            : ans
                            ? <span className="truncate block max-w-[150px]">{String(ans)}</span>
                            : <span className="text-slate-300">—</span>
                          }
                          {score !== null && q.question_type !== 'rating' && (
                            <span className="text-slate-400 ml-1">({score}/5)</span>
                          )}
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Question averages */}
          <div className="bg-slate-50 rounded-2xl p-5 border border-slate-200 mb-6">
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-widest mb-3">Question Averages</p>
            <div className="space-y-2">
              {resultsQuestions.map(q => {
                const scores = resultsResponses
                  .map(r => calcQuestionScore(q, r.answers?.[q.id]))
                  .filter(s => s !== null)
                const avg = scores.length > 0 ? scores.reduce((a, b) => a + b, 0) / scores.length : null
                return (
                  <div key={q.id} className="flex items-center gap-4">
                    <p className="flex-1 text-sm text-slate-700 min-w-0 truncate">{q.question_text}</p>
                    {avg !== null ? (
                      <>
                        <div className="w-32 bg-slate-200 rounded-full h-2 shrink-0">
                          <div
                            className={`h-2 rounded-full ${avg >= Number(resultsFor.rag_green_threshold) ? 'bg-green-400' : avg >= Number(resultsFor.rag_amber_threshold) ? 'bg-amber-400' : 'bg-red-400'}`}
                            style={{ width: `${(avg / 5) * 100}%` }}
                          />
                        </div>
                        <span className="text-sm font-bold text-slate-700 w-10 text-right shrink-0">{avg.toFixed(1)}</span>
                      </>
                    ) : (
                      <span className="text-xs text-slate-400 w-44 text-right shrink-0">qualitative only</span>
                    )}
                  </div>
                )
              })}
            </div>
          </div>

          {/* AI Insights panel */}
          <div className="border border-[#1F4E79]/20 rounded-2xl p-5 bg-[#1F4E79]/3">
            <div className="flex items-start justify-between mb-3">
              <div>
                <p className="text-xs font-semibold text-[#1F4E79] uppercase tracking-widest mb-0.5">📊 Survey Insights</p>
                {resultsFor.ai_insight_generated_at ? (
                  <p className="text-[11px] text-slate-400">
                    Generated {new Date(resultsFor.ai_insight_generated_at).toLocaleDateString()} · based on {resultsFor.ai_insight_response_count} response{resultsFor.ai_insight_response_count !== 1 ? 's' : ''}
                    {newResponsesSinceInsight > 0 && (
                      <span className="ml-2 text-amber-600 font-semibold">
                        🔔 {newResponsesSinceInsight} new response{newResponsesSinceInsight !== 1 ? 's' : ''} since last generation
                      </span>
                    )}
                  </p>
                ) : (
                  <p className="text-[11px] text-slate-400">No insight generated yet.</p>
                )}
              </div>
              <button
                onClick={generateInsight}
                disabled={generatingInsight || resultsResponses.length === 0}
                className="shrink-0 ml-4 text-xs font-semibold text-white bg-[#1F4E79] px-4 py-2 rounded-lg hover:bg-[#163a5c] transition-colors disabled:opacity-50"
              >
                {generatingInsight ? '⏳ Generating…' : resultsFor.ai_insight ? '↺ Regenerate Summary' : '📊 Generate Summary'}
              </button>
            </div>

            {resultsFor.ai_insight ? (
              <div className="bg-white rounded-xl p-4 border border-[#1F4E79]/10">
                <p className="text-sm text-slate-700 leading-relaxed whitespace-pre-wrap">{resultsFor.ai_insight}</p>
              </div>
            ) : !generatingInsight && (
              <div className="bg-white/60 rounded-xl p-4 border border-dashed border-[#1F4E79]/20 text-center">
                <p className="text-xs text-slate-400">Click "Generate Insights" to get an AI-powered analysis of these survey results.</p>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )

  // ── Survey list view ─────────────────────────────────────────────────────────
  return (
    <div>
      <div className="flex items-center justify-between mb-5">
        <p className="text-sm text-slate-500">
          Build phase surveys for Change Managers. Set RAG thresholds and generate AI insights once enough responses are in.
        </p>
        <button onClick={openNewSurvey}
          className="shrink-0 ml-4 bg-[#E8913A] text-white text-sm font-semibold px-4 py-2 rounded-lg hover:bg-[#d07e2e] transition-colors">
          + New Survey
        </button>
      </div>

      {loading ? (
        <p className="text-sm text-slate-400">Loading surveys…</p>
      ) : surveys.length === 0 ? (
        <div className="text-center py-12 bg-slate-50 rounded-xl border border-slate-200">
          <p className="text-3xl mb-3">📊</p>
          <p className="text-slate-400 text-sm mb-3">No surveys yet.</p>
          <button onClick={openNewSurvey} className="text-[#1F4E79] text-sm font-semibold hover:underline">+ Create the first survey</button>
        </div>
      ) : (
        <div className="space-y-3">
          {surveys.map(s => (
            <div key={s.id} className={`bg-white border rounded-2xl p-5 transition-opacity ${!s.is_active ? 'opacity-50' : ''}`}>
              <div className="flex items-start gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap mb-1">
                    <p className="font-semibold text-slate-800">{s.title}</p>
                    <span className="text-[10px] font-semibold bg-purple-100 text-purple-700 px-2 py-0.5 rounded-full">
                      Phase {String(s.phase_number).padStart(2,'0')}
                    </span>
                    {s.target_role && (
                      <span className="text-[10px] font-semibold bg-slate-100 text-slate-600 px-2 py-0.5 rounded-full">
                        {roles.find(r => r.code === s.target_role)?.label ?? s.target_role}
                      </span>
                    )}
                    {!s.is_active && (
                      <span className="text-[10px] bg-slate-100 text-slate-400 px-2 py-0.5 rounded-full font-semibold">Inactive</span>
                    )}
                    {s.ai_insight && (
                      <span className="text-[10px] font-semibold bg-[#1F4E79]/10 text-[#1F4E79] px-2 py-0.5 rounded-full">✦ Insight ready</span>
                    )}
                  </div>
                  {s.description && <p className="text-xs text-slate-500 mb-1">{s.description}</p>}
                  <p className="text-[11px] text-slate-400">
                    RAG thresholds: Green ≥ {s.rag_green_threshold} · Amber ≥ {s.rag_amber_threshold}
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0 flex-wrap justify-end">
                  <button onClick={() => viewResults(s)}
                    className="text-xs font-semibold text-[#E8913A] border border-[#E8913A]/30 hover:bg-[#E8913A]/5 px-3 py-1.5 rounded-lg transition-colors">
                    View Results
                  </button>
                  <button onClick={() => toggleActive(s)}
                    className={`text-xs font-semibold px-3 py-1 rounded-lg border transition-colors ${s.is_active ? 'text-slate-400 border-slate-200 hover:border-slate-300' : 'text-green-600 border-green-200 hover:bg-green-50'}`}>
                    {s.is_active ? 'Deactivate' : 'Activate'}
                  </button>
                  <button onClick={() => openEditSurvey(s)} className="text-xs text-[#1F4E79] hover:underline">Edit</button>
                  <button onClick={() => handleDelete(s.id)} className="text-xs text-red-400 hover:underline">Delete</button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── Survey Form Modal ── */}
      {showForm && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-start justify-center p-4 overflow-y-auto">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl my-8">
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
              <h2 className="font-semibold text-slate-800">{editId ? 'Edit Survey' : 'New Survey'}</h2>
              <button onClick={() => setShowForm(false)} className="text-slate-400 hover:text-slate-600 text-xl">✕</button>
            </div>

            <div className="px-6 py-5 space-y-4">
              {/* Title */}
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1">Title *</label>
                <input value={surveyForm.title} onChange={e => setSurveyForm({...surveyForm, title: e.target.value})}
                  placeholder="e.g. Phase 1 Change Readiness Check"
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#1F4E79]" />
              </div>

              {/* Description */}
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1">Description</label>
                <textarea value={surveyForm.description} onChange={e => setSurveyForm({...surveyForm, description: e.target.value})}
                  rows={2} placeholder="What is this survey assessing?"
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm resize-none focus:outline-none focus:border-[#1F4E79]" />
              </div>

              {/* Phase + Role */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">Phase *</label>
                  <select value={surveyForm.phase_number} onChange={e => setSurveyForm({...surveyForm, phase_number: Number(e.target.value)})}
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#1F4E79]">
                    {PHASES.map(p => <option key={p.num} value={p.num}>{p.label}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">Target Role <span className="font-normal text-slate-400">(blank = all)</span></label>
                  <select value={surveyForm.target_role} onChange={e => setSurveyForm({...surveyForm, target_role: e.target.value})}
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#1F4E79]">
                    <option value="">All roles</option>
                    {roles.map(r => <option key={r.code} value={r.code}>{r.label}</option>)}
                  </select>
                </div>
              </div>

              {/* RAG Thresholds */}
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-2">RAG Thresholds <span className="font-normal text-slate-400">(score out of 5)</span></label>
                <div className="grid grid-cols-2 gap-3">
                  <div className="flex items-center gap-2 bg-green-50 border border-green-100 rounded-lg px-3 py-2">
                    <span className="text-xs font-semibold text-green-700 shrink-0">● Green ≥</span>
                    <input type="number" step="0.1" min="1" max="5"
                      value={surveyForm.rag_green_threshold}
                      onChange={e => setSurveyForm({...surveyForm, rag_green_threshold: e.target.value})}
                      className="w-full text-sm text-green-700 font-bold bg-transparent focus:outline-none" />
                  </div>
                  <div className="flex items-center gap-2 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2">
                    <span className="text-xs font-semibold text-amber-700 shrink-0">● Amber ≥</span>
                    <input type="number" step="0.1" min="1" max="5"
                      value={surveyForm.rag_amber_threshold}
                      onChange={e => setSurveyForm({...surveyForm, rag_amber_threshold: e.target.value})}
                      className="w-full text-sm text-amber-700 font-bold bg-transparent focus:outline-none" />
                  </div>
                </div>
                <p className="text-[10px] text-slate-400 mt-1">Below Amber threshold = Red</p>
              </div>

              {/* Question builder */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="block text-xs font-semibold text-slate-600">Questions *</label>
                  <button onClick={addQuestion}
                    className="text-xs font-semibold text-[#1F4E79] border border-[#1F4E79]/30 px-3 py-1 rounded-lg hover:bg-[#1F4E79]/5 transition-colors">
                    + Add Question
                  </button>
                </div>

                {formQuestions.length === 0 ? (
                  <div className="text-center py-6 bg-slate-50 rounded-xl border border-dashed border-slate-300">
                    <p className="text-slate-400 text-xs">No questions yet.</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {formQuestions.map((q, idx) => (
                      <div key={q._id} className="bg-slate-50 rounded-xl border border-slate-200 p-3">
                        <div className="flex items-start gap-2">
                          {/* Reorder */}
                          <div className="flex flex-col gap-0.5 pt-1 shrink-0">
                            <button onClick={() => moveQuestion(q._id, -1)} disabled={idx === 0}
                              className="text-slate-300 hover:text-slate-500 disabled:opacity-30 text-xs">▲</button>
                            <button onClick={() => moveQuestion(q._id, 1)} disabled={idx === formQuestions.length - 1}
                              className="text-slate-300 hover:text-slate-500 disabled:opacity-30 text-xs">▼</button>
                          </div>

                          {/* Question text */}
                          <input
                            value={q.question_text}
                            onChange={e => updateQuestion(q._id, 'question_text', e.target.value)}
                            placeholder={`Question ${idx + 1}`}
                            className="flex-1 border border-slate-200 rounded-lg px-3 py-1.5 text-sm bg-white focus:outline-none focus:border-[#1F4E79]"
                          />

                          {/* Type */}
                          <select value={q.question_type}
                            onChange={e => updateQuestion(q._id, 'question_type', e.target.value)}
                            className="border border-slate-200 rounded-lg px-2 py-1.5 text-xs bg-white focus:outline-none focus:border-[#1F4E79] shrink-0">
                            {QUESTION_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                          </select>

                          {/* Required */}
                          <label className="flex items-center gap-1 shrink-0 cursor-pointer pt-1.5">
                            <input type="checkbox" checked={q.is_required}
                              onChange={e => updateQuestion(q._id, 'is_required', e.target.checked)}
                              className="w-3 h-3 accent-[#1F4E79]" />
                            <span className="text-[10px] text-slate-500">Req</span>
                          </label>

                          {/* Delete */}
                          <button onClick={() => removeQuestion(q._id)}
                            className="text-slate-300 hover:text-red-400 transition-colors pt-1 shrink-0">✕</button>
                        </div>

                        {/* Options — only for single_choice */}
                        {q.question_type === 'single_choice' && (
                          <div className="mt-2 ml-7 space-y-1.5">
                            <p className="text-[10px] text-slate-400 font-semibold uppercase">Options (label + score)</p>
                            {q.options.map(opt => (
                              <div key={opt._optId} className="flex items-center gap-2">
                                <input value={opt.label} onChange={e => updateOption(q._id, opt._optId, 'label', e.target.value)}
                                  placeholder="Option label"
                                  className="flex-1 border border-slate-200 rounded-lg px-2 py-1 text-xs bg-white focus:outline-none focus:border-[#1F4E79]" />
                                <input type="number" min="1" max="5" value={opt.score}
                                  onChange={e => updateOption(q._id, opt._optId, 'score', e.target.value)}
                                  className="w-14 border border-slate-200 rounded-lg px-2 py-1 text-xs bg-white focus:outline-none focus:border-[#1F4E79]" />
                                <span className="text-[10px] text-slate-400 shrink-0">pts</span>
                                <button onClick={() => removeOption(q._id, opt._optId)}
                                  className="text-slate-300 hover:text-red-400 text-xs shrink-0">✕</button>
                              </div>
                            ))}
                            <button onClick={() => addOption(q._id)}
                              className="text-xs text-[#1F4E79] hover:underline">+ Add option</button>
                          </div>
                        )}

                        {/* Score info for other types */}
                        {q.question_type === 'rating' && (
                          <p className="text-[10px] text-slate-400 mt-1.5 ml-7">Score = star value (1–5)</p>
                        )}
                        {q.question_type === 'yes_no' && (
                          <p className="text-[10px] text-slate-400 mt-1.5 ml-7">Score: Yes = 5, No = 1</p>
                        )}
                        {q.question_type === 'text' && (
                          <p className="text-[10px] text-slate-400 mt-1.5 ml-7">Qualitative only — no score contribution</p>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Active + Order */}
              <div className="flex items-center justify-between">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={surveyForm.is_active}
                    onChange={e => setSurveyForm({...surveyForm, is_active: e.target.checked})}
                    className="w-4 h-4 accent-[#1F4E79]" />
                  <span className="text-sm text-slate-700">Active <span className="text-slate-400 text-xs">(visible to target role on phase pages)</span></span>
                </label>
                <div className="flex items-center gap-2">
                  <label className="text-xs text-slate-500">Order</label>
                  <input type="number" value={surveyForm.sort_order}
                    onChange={e => setSurveyForm({...surveyForm, sort_order: Number(e.target.value)})}
                    className="w-16 border border-slate-200 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:border-[#1F4E79]" />
                </div>
              </div>

              {formError && <p className="text-sm text-red-500">{formError}</p>}
            </div>

            <div className="px-6 py-4 border-t border-slate-100 flex justify-end gap-3">
              <button onClick={() => setShowForm(false)} className="text-sm text-slate-500 hover:text-slate-700 px-4 py-2">Cancel</button>
              <button onClick={handleSave} disabled={saving}
                className="bg-[#1F4E79] text-white text-sm font-semibold px-6 py-2 rounded-lg hover:bg-[#163a5c] transition-colors disabled:opacity-60">
                {saving ? 'Saving…' : editId ? 'Save Changes' : 'Create Survey'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
