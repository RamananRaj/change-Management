import { useState, useEffect } from 'react'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../lib/supabase'

const typeLabels = { exercise: 'Exercise', tool: 'Tool', template: 'Template' }
const typeIcons  = { exercise: '🎯', tool: '🔧', template: '📄' }

// ── Shared table cell helpers ────────────────────────────────────────────────

function emptyRow(columns) {
  const row = {}
  columns.forEach(col => {
    row[col.key] = col.type === 'checkbox' ? false : col.type === 'rating' ? 0 : ''
  })
  return row
}

function RatingInput({ value, onChange, disabled }) {
  const val = Number(value) || 0
  return (
    <div className="flex gap-0.5">
      {[1,2,3,4,5].map(n => (
        <button
          key={n}
          type="button"
          disabled={disabled}
          onClick={() => onChange(val === n ? 0 : n)}
          className={`text-lg leading-none transition-colors ${disabled ? 'cursor-default' : 'cursor-pointer'} ${n <= val ? 'text-[#E8913A]' : 'text-slate-200'}`}
        >★</button>
      ))}
    </div>
  )
}

function CellInput({ col, value, onChange, disabled }) {
  const base = 'w-full text-xs text-slate-700 focus:outline-none focus:ring-1 focus:ring-[#1F4E79]/30 rounded'

  if (col.type === 'select') return (
    <select
      value={value ?? ''}
      onChange={e => onChange(e.target.value)}
      disabled={disabled}
      className={`${base} border-0 bg-transparent px-1 py-0.5 disabled:text-slate-400`}
    >
      <option value="">—</option>
      {(col.options ?? []).map(opt => <option key={opt} value={opt}>{opt}</option>)}
    </select>
  )

  if (col.type === 'rating') return <RatingInput value={value} onChange={onChange} disabled={disabled} />

  if (col.type === 'checkbox') return (
    <input
      type="checkbox"
      checked={!!value}
      onChange={e => onChange(e.target.checked)}
      disabled={disabled}
      className="w-4 h-4 accent-[#1F4E79] cursor-pointer"
    />
  )

  return (
    <input
      type={col.type === 'number' ? 'number' : col.type === 'date' ? 'date' : 'text'}
      value={value ?? ''}
      onChange={e => onChange(e.target.value)}
      disabled={disabled}
      placeholder={col.required ? '(required)' : ''}
      className={`${base} border-0 bg-transparent px-1 py-0.5 placeholder:text-slate-300 disabled:text-slate-400`}
    />
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export default function ExerciseDrawer({ item, activity, onClose, onActivityChange }) {
  const { user } = useAuth()

  // Exercise state
  const [notes,   setNotes]   = useState(activity?.notes ?? '')
  const [saving,  setSaving]  = useState(false)
  const [status,  setStatus]  = useState(activity?.status ?? 'in_progress')
  const [saved,   setSaved]   = useState(false)

  // Linked template state
  const [linkedTemplate,  setLinkedTemplate]  = useState(null)
  const [templateRows,    setTemplateRows]    = useState([])
  const [templateSaving,  setTemplateSaving]  = useState(false)
  const [templateSaved,   setTemplateSaved]   = useState(false)
  const [templateLoading, setTemplateLoading] = useState(false)

  // Prevent body scroll while drawer open
  useEffect(() => {
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = '' }
  }, [])

  // Load linked template if present
  useEffect(() => {
    if (item.template_id) loadLinkedTemplate()
  }, [item.template_id])

  async function loadLinkedTemplate() {
    setTemplateLoading(true)

    const { data: tmpl } = await supabase
      .from('templates')
      .select('*')
      .eq('id', item.template_id)
      .single()

    if (!tmpl) { setTemplateLoading(false); return }
    setLinkedTemplate(tmpl)

    const { data: resp } = await supabase
      .from('template_responses')
      .select('*')
      .eq('user_id', user.id)
      .eq('template_id', item.template_id)
      .single()

    setTemplateRows(resp ? (resp.rows ?? []) : [emptyRow(tmpl.columns ?? [])])
    setTemplateLoading(false)
  }

  function updateTemplateCell(rowIdx, key, val) {
    setTemplateRows(prev => prev.map((r, i) => i === rowIdx ? { ...r, [key]: val } : r))
  }

  function addTemplateRow() {
    if (!linkedTemplate) return
    setTemplateRows(prev => [...prev, emptyRow(linkedTemplate.columns ?? [])])
  }

  function deleteTemplateRow(idx) {
    if (templateRows.length === 1) return
    setTemplateRows(prev => prev.filter((_, i) => i !== idx))
  }

  async function saveTemplateRows() {
    if (!linkedTemplate) return
    setTemplateSaving(true)
    await supabase
      .from('template_responses')
      .upsert({
        user_id:     user.id,
        template_id: linkedTemplate.id,
        rows:        templateRows,
        status:      'in_progress',
        updated_at:  new Date().toISOString(),
      }, { onConflict: 'user_id,template_id' })
    setTemplateSaving(false)
    setTemplateSaved(true)
    setTimeout(() => setTemplateSaved(false), 2000)
  }

  // Exercise save / complete
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

  // Re-open a completed exercise for editing. It drops back to in-progress, so the
  // user must click "Mark as complete" again once they're done (no silent re-complete).
  async function reopen() {
    setSaving(true)
    await supabase.from('user_activities').upsert({
      user_id:      user.id,
      content_id:   item.id,
      phase_number: item.phase_number,
      status:       'in_progress',
      notes,
      updated_at:   new Date().toISOString(),
    }, { onConflict: 'user_id,content_id' })
    setStatus('in_progress')
    setSaving(false)
    onActivityChange?.()
  }

  const isCompleted = status === 'completed'
  const readOnly = isCompleted
  const cols = linkedTemplate?.columns ?? []

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 bg-black/50 z-40 transition-opacity" onClick={onClose} />

      {/* Centered floating modal — grows wider when a template table is embedded */}
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 pointer-events-none">
      <div className={`relative bg-white rounded-2xl shadow-2xl flex flex-col pointer-events-auto w-full ${linkedTemplate ? 'max-w-6xl' : 'max-w-2xl'}`} style={{ maxHeight: '92vh' }}>

        {/* Header */}
        <div className="flex items-start justify-between px-6 py-5 border-b border-slate-100 shrink-0">
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
          >✕</button>
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

          {/* ── Linked Template Table ── */}
          {item.template_id && (
            <div className="mb-6">
              <div className="flex items-center justify-between mb-3">
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-widest">
                  📋 {linkedTemplate?.title ?? 'Template'}
                </p>
                {linkedTemplate?.file_url && (
                  <a
                    href={linkedTemplate.file_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1.5 text-xs font-semibold text-[#1F4E79] border border-[#1F4E79]/30 px-3 py-1.5 rounded-lg hover:bg-[#1F4E79]/5 transition-colors"
                  >
                    ⬇ Download
                  </a>
                )}
              </div>

              {templateLoading ? (
                <div className="space-y-2">
                  {[1,2,3].map(n => <div key={n} className="h-10 bg-slate-100 rounded animate-pulse" />)}
                </div>
              ) : cols.length === 0 ? (
                <p className="text-slate-400 text-sm text-center py-8">No columns defined for this template yet.</p>
              ) : (
                <>
                  <div className="overflow-x-auto border border-slate-200 rounded-2xl">
                    <table className="w-full text-left border-collapse">
                      <thead>
                        <tr className="bg-[#1F4E79]">
                          {cols.map(col => (
                            <th key={col.key} className="px-3 py-2.5 text-xs font-semibold text-white whitespace-nowrap">
                              {col.label}
                              {col.required && <span className="text-[#E8913A] ml-0.5">*</span>}
                            </th>
                          ))}
                          {!readOnly && <th className="px-2 py-2.5 w-8" />}
                        </tr>
                      </thead>
                      <tbody>
                        {templateRows.map((row, rowIdx) => (
                          <tr
                            key={rowIdx}
                            className={`border-b border-slate-100 ${rowIdx % 2 === 0 ? 'bg-white' : 'bg-slate-50/50'} ${!readOnly ? 'hover:bg-blue-50/30' : ''}`}
                          >
                            {cols.map(col => (
                              <td key={col.key} className="px-3 py-2 min-w-[120px]">
                                <CellInput
                                  col={col}
                                  value={row[col.key]}
                                  onChange={val => updateTemplateCell(rowIdx, col.key, val)}
                                  disabled={readOnly}
                                />
                              </td>
                            ))}
                            {!readOnly && (
                              <td className="px-2 py-2 text-center">
                                <button
                                  onClick={() => deleteTemplateRow(rowIdx)}
                                  disabled={templateRows.length === 1}
                                  className="text-slate-200 hover:text-red-400 transition-colors disabled:opacity-0 text-sm"
                                >✕</button>
                              </td>
                            )}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  {!readOnly && (
                    <div className="flex items-center justify-between mt-2">
                      <button
                        onClick={addTemplateRow}
                        className="flex items-center gap-2 text-xs font-semibold text-[#1F4E79] hover:text-[#163a5c] transition-colors"
                      >
                        <span className="w-6 h-6 rounded-full border-2 border-[#1F4E79]/30 flex items-center justify-center text-sm">+</span>
                        Add row
                      </button>
                      <button
                        onClick={saveTemplateRows}
                        disabled={templateSaving}
                        className="text-xs font-semibold text-[#1F4E79] border border-[#1F4E79]/30 px-3 py-1.5 rounded-lg hover:bg-[#1F4E79]/5 transition-colors disabled:opacity-50"
                      >
                        {templateSaving ? 'Saving…' : templateSaved ? '✓ Saved' : 'Save table'}
                      </button>
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          {/* Template body + download — only for template content type without a linked table */}
          {item.content_type === 'template' && item.body && !item.template_id && (
            <div className="mb-6">
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-widest">Template Content</p>
                {item.file_url && (
                  <a
                    href={item.file_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1.5 text-xs font-semibold text-[#1F4E79] border border-[#1F4E79]/30 px-3 py-1.5 rounded-lg hover:bg-[#1F4E79]/5 transition-colors"
                  >
                    ⬇ Download file
                  </a>
                )}
              </div>
              <div className="bg-white border border-slate-200 rounded-2xl p-5 text-xs text-slate-700 leading-relaxed whitespace-pre-wrap font-mono">
                {item.body}
              </div>
            </div>
          )}

          {/* Download only (no body, no linked table) */}
          {item.content_type === 'template' && !item.body && item.file_url && !item.template_id && (
            <div className="mb-6">
              <a
                href={item.file_url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-center gap-2 w-full text-sm font-semibold text-white bg-[#1F4E79] px-4 py-3 rounded-xl hover:bg-[#163a5c] transition-colors"
              >
                ⬇ Download Template
              </a>
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
              rows={linkedTemplate ? 5 : 10}
              disabled={readOnly}
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
        <div className="px-6 py-4 border-t border-slate-100 bg-white shrink-0">
          {isCompleted ? (
            // Completed — read-only. "Edit" reopens it to in-progress so it must be re-completed.
            <div className="flex items-center justify-between">
              <p className="text-sm text-green-600 font-medium">✓ This {item.content_type} is complete</p>
              <div className="flex gap-2">
                <button onClick={reopen} disabled={saving} className="text-sm font-semibold text-[#1F4E79] border border-[#1F4E79]/30 px-4 py-2 rounded-lg hover:bg-[#1F4E79]/5 transition-colors disabled:opacity-50">
                  {saving ? 'Reopening…' : 'Edit'}
                </button>
                <button onClick={onClose} className="text-sm text-slate-500 hover:text-slate-700 border border-slate-200 px-4 py-2 rounded-lg">
                  Close
                </button>
              </div>
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
