import { useState, useEffect } from 'react'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../lib/supabase'

function emptyRow(columns) {
  const row = {}
  columns.forEach(col => { row[col.key] = col.type === 'checkbox' ? false : col.type === 'rating' ? 0 : '' })
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

  if (col.type === 'select') {
    return (
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
  }

  if (col.type === 'rating') {
    return <RatingInput value={value} onChange={onChange} disabled={disabled} />
  }

  if (col.type === 'checkbox') {
    return (
      <input
        type="checkbox"
        checked={!!value}
        onChange={e => onChange(e.target.checked)}
        disabled={disabled}
        className="w-4 h-4 accent-[#1F4E79] cursor-pointer"
      />
    )
  }

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

export default function TemplateDrawer({ template, onClose }) {
  const { user } = useAuth()
  const [rows,      setRows]      = useState([])
  const [status,    setStatus]    = useState('in_progress')
  const [saving,    setSaving]    = useState(false)
  const [saved,     setSaved]     = useState(false)
  const [loading,   setLoading]   = useState(true)

  const columns  = template.columns ?? []
  const isCompleted = status === 'completed'

  // Prevent body scroll
  useEffect(() => {
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = '' }
  }, [])

  // Load existing response
  useEffect(() => {
    async function load() {
      const { data } = await supabase
        .from('template_responses')
        .select('*')
        .eq('user_id', user.id)
        .eq('template_id', template.id)
        .single()

      if (data) {
        setRows(data.rows ?? [])
        setStatus(data.status ?? 'in_progress')
      } else {
        // Start with one empty row
        setRows([emptyRow(columns)])
      }
      setLoading(false)
    }
    load()
  }, [template.id, user.id])

  function updateCell(rowIdx, key, val) {
    setRows(prev => prev.map((r, i) => i === rowIdx ? { ...r, [key]: val } : r))
  }

  function addRow() {
    setRows(prev => [...prev, emptyRow(columns)])
  }

  function deleteRow(idx) {
    if (rows.length === 1) return // keep at least 1 row
    setRows(prev => prev.filter((_, i) => i !== idx))
  }

  async function save(markComplete = false) {
    setSaving(true)
    const newStatus = markComplete ? 'completed' : 'in_progress'
    const payload = {
      user_id:      user.id,
      template_id:  template.id,
      rows,
      status:       newStatus,
      updated_at:   new Date().toISOString(),
      ...(markComplete ? { completed_at: new Date().toISOString() } : {}),
    }
    await supabase
      .from('template_responses')
      .upsert(payload, { onConflict: 'user_id,template_id' })

    setStatus(newStatus)
    setSaving(false)
    if (!markComplete) {
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } else {
      onClose()
    }
  }

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 bg-black/40 z-40" onClick={onClose} />

      {/* Wide drawer */}
      <div className="fixed right-0 top-0 h-full w-full max-w-4xl bg-white z-50 shadow-2xl flex flex-col">

        {/* Header */}
        <div className="flex items-start justify-between px-6 py-5 border-b border-slate-100 shrink-0">
          <div className="flex-1 min-w-0 pr-4">
            <div className="flex items-center gap-2 mb-1.5">
              <span className="text-lg">📋</span>
              <span className="text-xs font-semibold text-slate-400 uppercase tracking-widest">Template</span>
              {isCompleted && (
                <span className="text-xs font-semibold bg-green-100 text-green-700 px-2 py-0.5 rounded-full">✓ Completed</span>
              )}
              {!isCompleted && status === 'in_progress' && rows.length > 1 && (
                <span className="text-xs font-semibold bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full">● In Progress</span>
              )}
            </div>
            <h2 className="font-bold text-slate-800 text-lg leading-snug">{template.title}</h2>
            {template.description && (
              <p className="text-xs text-slate-500 mt-1">{template.description}</p>
            )}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {template.file_url && (
              <a
                href={template.file_url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1.5 text-xs font-semibold text-[#1F4E79] border border-[#1F4E79]/30 px-3 py-1.5 rounded-lg hover:bg-[#1F4E79]/5 transition-colors"
              >
                ⬇ Download
              </a>
            )}
            <button
              onClick={onClose}
              className="w-8 h-8 rounded-full bg-slate-100 hover:bg-slate-200 flex items-center justify-center text-slate-500 transition-colors"
            >✕</button>
          </div>
        </div>

        {/* Table area */}
        <div className="flex-1 overflow-auto px-6 py-5">
          {loading ? (
            <div className="space-y-2">
              {[1,2,3].map(n => <div key={n} className="h-10 bg-slate-100 rounded animate-pulse" />)}
            </div>
          ) : columns.length === 0 ? (
            <p className="text-slate-400 text-sm text-center py-12">This template has no columns defined yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-[#1F4E79]">
                    {columns.map(col => (
                      <th key={col.key} className="px-3 py-2.5 text-xs font-semibold text-white whitespace-nowrap">
                        {col.label}
                        {col.required && <span className="text-[#E8913A] ml-0.5">*</span>}
                      </th>
                    ))}
                    {!isCompleted && (
                      <th className="px-2 py-2.5 w-8" />
                    )}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row, rowIdx) => (
                    <tr
                      key={rowIdx}
                      className={`border-b border-slate-100 ${rowIdx % 2 === 0 ? 'bg-white' : 'bg-slate-50/50'} ${!isCompleted ? 'hover:bg-blue-50/30' : ''}`}
                    >
                      {columns.map(col => (
                        <td key={col.key} className="px-3 py-2 min-w-[120px]">
                          <CellInput
                            col={col}
                            value={row[col.key]}
                            onChange={val => updateCell(rowIdx, col.key, val)}
                            disabled={isCompleted}
                          />
                        </td>
                      ))}
                      {!isCompleted && (
                        <td className="px-2 py-2 text-center">
                          <button
                            onClick={() => deleteRow(rowIdx)}
                            disabled={rows.length === 1}
                            className="text-slate-200 hover:text-red-400 transition-colors disabled:opacity-0 text-sm"
                          >✕</button>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>

              {!isCompleted && (
                <button
                  onClick={addRow}
                  className="mt-3 flex items-center gap-2 text-xs font-semibold text-[#1F4E79] hover:text-[#163a5c] transition-colors"
                >
                  <span className="w-6 h-6 rounded-full border-2 border-[#1F4E79]/30 flex items-center justify-center text-sm">+</span>
                  Add row
                </button>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-slate-100 bg-white shrink-0">
          {isCompleted ? (
            <div className="flex items-center justify-between">
              <p className="text-sm text-green-600 font-medium">✓ This template is complete</p>
              <button onClick={onClose} className="text-sm text-slate-500 hover:text-slate-700 border border-slate-200 px-4 py-2 rounded-lg">
                Close
              </button>
            </div>
          ) : (
            <div className="flex gap-3">
              <button
                onClick={() => save(false)}
                disabled={saving}
                className="flex-1 text-sm font-semibold text-[#1F4E79] border border-[#1F4E79]/30 px-4 py-2.5 rounded-xl hover:bg-[#1F4E79]/5 transition-colors disabled:opacity-50"
              >
                {saving ? 'Saving…' : saved ? '✓ Saved' : 'Save progress'}
              </button>
              <button
                onClick={() => save(true)}
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
