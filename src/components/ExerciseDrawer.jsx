import { useState, useEffect } from 'react'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../lib/supabase'

const typeLabels = { exercise: 'Exercise', tool: 'Tool', template: 'Template' }
const typeIcons  = { exercise: '🎯', tool: '🔧', template: '📄' }

export default function ExerciseDrawer({ item, activity, onClose, onActivityChange }) {
  const { user } = useAuth()
  const [notes,   setNotes]   = useState(activity?.notes ?? '')
  const [saving,  setSaving]  = useState(false)
  const [status,  setStatus]  = useState(activity?.status ?? 'in_progress')
  const [saved,   setSaved]   = useState(false)

  // Prevent body scroll while drawer open
  useEffect(() => {
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = '' }
  }, [])

  async function saveNotes() {
    setSaving(true)
    const payload = {
      user_id:      user.id,
      content_id:   item.id,
      phase_number: item.phase_number,
      status,
      notes,
      updated_at:   new Date().toISOString(),
    }
    const { error } = await supabase
      .from('user_activities')
      .upsert(payload, { onConflict: 'user_id,content_id' })

    setSaving(false)
    if (!error) {
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
      onActivityChange?.()
    }
  }

  async function markComplete() {
    setSaving(true)
    const payload = {
      user_id:      user.id,
      content_id:   item.id,
      phase_number: item.phase_number,
      status:       'completed',
      notes,
      completed_at: new Date().toISOString(),
      updated_at:   new Date().toISOString(),
    }
    await supabase
      .from('user_activities')
      .upsert(payload, { onConflict: 'user_id,content_id' })

    setStatus('completed')
    setSaving(false)
    onActivityChange?.()
    onClose()
  }

  const isCompleted = status === 'completed'

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/40 z-40 transition-opacity"
        onClick={onClose}
      />

      {/* Drawer */}
      <div className="fixed right-0 top-0 h-full w-full max-w-xl bg-white z-50 shadow-2xl flex flex-col">

        {/* Header */}
        <div className="flex items-start justify-between px-6 py-5 border-b border-slate-100">
          <div className="flex-1 min-w-0 pr-4">
            <div className="flex items-center gap-2 mb-1.5">
              <span className="text-lg">{typeIcons[item.content_type]}</span>
              <span className="text-xs font-semibold text-slate-400 uppercase tracking-widest">
                {typeLabels[item.content_type]}
              </span>
              {isCompleted && (
                <span className="text-xs font-semibold bg-green-100 text-green-700 px-2 py-0.5 rounded-full">
                  ✓ Completed
                </span>
              )}
              {!isCompleted && activity && (
                <span className="text-xs font-semibold bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full">
                  ● In Progress
                </span>
              )}
            </div>
            <h2 className="font-bold text-slate-800 text-lg leading-snug">{item.title}</h2>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-slate-100 hover:bg-slate-200 flex items-center justify-center text-slate-500 transition-colors shrink-0"
          >
            ✕
          </button>
        </div>

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto px-6 py-5">

          {/* Description */}
          {item.description && (
            <div className="bg-slate-50 rounded-2xl p-4 border border-slate-100 mb-6">
              <p className="text-xs font-semibold text-slate-400 uppercase tracking-widest mb-2">About this {item.content_type}</p>
              <p className="text-sm text-slate-600 leading-relaxed">{item.description}</p>
            </div>
          )}

          {/* Notes workspace */}
          <div className="mb-6">
            <label className="block text-xs font-semibold text-slate-500 uppercase tracking-widest mb-2">
              Your Notes & Outputs
            </label>
            <textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              placeholder={getPlaceholder(item.content_type)}
              rows={10}
              disabled={isCompleted}
              className="w-full border border-slate-200 rounded-2xl px-4 py-3 text-sm text-slate-700 leading-relaxed resize-none focus:outline-none focus:border-[#1F4E79] placeholder:text-slate-300 disabled:bg-slate-50 disabled:text-slate-400"
            />
            <p className="text-[11px] text-slate-400 mt-1.5">
              Your notes are saved privately — only you can see them.
            </p>
          </div>

          {/* Tips */}
          <div className="bg-[#1F4E79]/5 rounded-2xl p-4 border border-[#1F4E79]/10">
            <p className="text-xs font-semibold text-[#1F4E79] mb-1.5">💡 Tips for this {item.content_type}</p>
            <p className="text-xs text-slate-500 leading-relaxed">{getTip(item.content_type)}</p>
          </div>
        </div>

        {/* Footer actions */}
        <div className="px-6 py-4 border-t border-slate-100 bg-white">
          {isCompleted ? (
            <div className="flex items-center justify-between">
              <p className="text-sm text-green-600 font-medium">✓ This {item.content_type} is complete</p>
              <button onClick={onClose} className="text-sm text-slate-500 hover:text-slate-700 border border-slate-200 px-4 py-2 rounded-lg">
                Close
              </button>
            </div>
          ) : (
            <div className="flex gap-3">
              <button
                onClick={saveNotes}
                disabled={saving}
                className="flex-1 text-sm font-semibold text-[#1F4E79] border border-[#1F4E79]/30 px-4 py-2.5 rounded-xl hover:bg-[#1F4E79]/5 transition-colors disabled:opacity-50"
              >
                {saving ? 'Saving…' : saved ? '✓ Saved' : 'Save notes'}
              </button>
              <button
                onClick={markComplete}
                disabled={saving}
                className="flex-1 text-sm font-bold text-white bg-[#1F4E79] px-4 py-2.5 rounded-xl hover:bg-[#163a5c] transition-colors disabled:opacity-50"
              >
                {saving ? 'Saving…' : 'Mark as complete ✓'}
              </button>
            </div>
          )}
        </div>
      </div>
    </>
  )
}

function getPlaceholder(type) {
  if (type === 'exercise') return 'Write your observations, findings, and outputs here…\n\nE.g. Key stakeholders identified, readiness scores, risks noted…'
  if (type === 'tool')     return 'Capture your inputs, decisions, and results here…\n\nE.g. Scores, ratings, analysis outputs…'
  return 'Add your completed template content or notes here…\n\nE.g. Draft text, key sections filled in, review notes…'
}

function getTip(type) {
  if (type === 'exercise') return 'Work through this exercise with your team where possible. Document your actual findings rather than ideal-state answers — honest assessments lead to better change plans.'
  if (type === 'tool')     return 'Use this tool to structure your thinking. You can save your progress and come back. Share the output with your sponsor or team before moving on.'
  return 'Fill in the template with your specific context. The more detail you add now, the less rework you will need later. Download and share with stakeholders once complete.'
}
