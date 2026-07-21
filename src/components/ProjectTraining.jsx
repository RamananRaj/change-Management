import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { buildNeedsMatrix, summariseDemand, DELIVERY_LABEL, MODULE_STATUS_LABEL } from '../lib/ai/analysis'

// Step 4 of the people-leader training build: the needs matrix on screen.
//
// The grid IS the analysis. A change manager asked for a "training needs analysis"
// is being asked for exactly this: groups down the side, modules across the top,
// and a mark where a group needs a module. It normally lives in a spreadsheet.

const STATUS_STYLE = {
  ready:    { dot: '#16A34A', text: 'text-slate-500' },
  in_build: { dot: '#E8913A', text: 'text-amber-600' },
  planned:  { dot: '#94A3B8', text: 'text-slate-500' },
  retired:  { dot: '#CBD5E1', text: 'text-slate-400' },
}

const emptyModule = { name: '', delivery: '', duration_min: '', owner_name: '', status: 'planned',
  ready_on: '', window_start: '', window_end: '', notes: '' }

export default function ProjectTraining({ project, readOnly = false }) {
  const [modules, setModules]     = useState([])
  const [audiences, setAudiences] = useState([])
  const [demand, setDemand]       = useState([])
  const [loading, setLoading]     = useState(true)
  const [error, setError]         = useState(null)
  const [form, setForm]           = useState(null)      // module editor
  const [cell, setCell]           = useState(null)      // needs-cell editor
  const [saving, setSaving]       = useState(false)

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (project?.id) load() }, [project?.id])

  async function load({ quiet = false } = {}) {
    if (!quiet) setLoading(true)
    const [m, a, d] = await Promise.all([
      supabase.from('training_modules').select('*').eq('project_id', project.id).order('sort_order'),
      supabase.from('audiences').select('id, name, headcount, owner_name, parent_id, sort_order').eq('project_id', project.id).order('sort_order'),
      supabase.from('training_demand').select('*').eq('project_id', project.id),
    ])
    const err = m.error || a.error || d.error
    if (err) setError(err.message)
    setModules(m.data ?? []); setAudiences(a.data ?? []); setDemand(d.data ?? [])
    setLoading(false)
  }

  async function saveModule() {
    if (!form.name.trim()) return
    setSaving(true); setError(null)
    const payload = {
      project_id: project.id,
      name: form.name.trim(),
      delivery: form.delivery || null,
      // Same rule as headcount: blank is unknown, and Number('') is 0, which would
      // claim a zero-minute module.
      duration_min: form.duration_min === '' ? null : Number(form.duration_min),
      owner_name: form.owner_name?.trim() || null,
      status: form.status || 'planned',
      ready_on:     form.ready_on     || null,
      window_start: form.window_start || null,
      window_end:   form.window_end   || null,
      notes: form.notes?.trim() || null,
      sort_order: form.sort_order ?? modules.length,
    }
    const q = form.id
      ? supabase.from('training_modules').update(payload).eq('id', form.id).select('id')
      : supabase.from('training_modules').insert(payload).select('id')
    const { data, error: err } = await q
    setSaving(false)
    if (err || !data?.length) { setError(err?.message ?? 'Could not save.'); return }
    setForm(null); load({ quiet: true })
  }

  async function removeModule(m) {
    if (!window.confirm(`Delete “${m.name}”? Every need against it is removed too.`)) return
    const { error: err } = await supabase.from('training_modules').delete().eq('id', m.id)
    if (err) { setError(err.message); return }
    setForm(null); load({ quiet: true })
  }

  // Cell editing. A need row exists only where there is a need, so clearing a cell
  // deletes the row rather than writing a "not required" value — one way to say it.
  async function saveCell(next) {
    setSaving(true); setError(null)
    const { audience_id, module_id, need_id } = cell
    let err
    if (!next) {
      if (need_id) ({ error: err } = await supabase.from('training_needs').delete().eq('id', need_id))
    } else if (need_id) {
      ({ error: err } = await supabase.from('training_needs').update(next).eq('id', need_id))
    } else {
      ({ error: err } = await supabase.from('training_needs').insert({ audience_id, module_id, ...next }))
    }
    setSaving(false)
    if (err) { setError(err.message); return }
    setCell(null); load({ quiet: true })
  }

  if (loading) return <div className="h-48 bg-slate-100 rounded-2xl animate-pulse" />

  const matrix  = buildNeedsMatrix(demand, { audiences, modules })
  const summary = summariseDemand(demand)

  const openCell = (r, c, existing) => {
    if (readOnly) return
    const d = demand.find(x => x.audience_id === r.id && x.module_id === c.id)
    setCell({
      audience_id: r.id, module_id: c.id, need_id: d?.need_id ?? null,
      audience: r.name, module: c.name, headcount: r.headcount,
      necessity: d?.necessity ?? 'mandatory',
      // Reads back the stored override. This was blank until the view exposed the
      // column, so opening a partial cell and saving overwrote the real number.
      applies_to: d?.applies_to ?? '',
      exists: !!existing,
    })
  }

  return (
    <div>
      <div className="flex items-start justify-between mb-4 gap-3 flex-wrap">
        <p className="text-xs text-slate-500 max-w-xl">
          What each group has to be able to do after go-live. Click any cell to set or clear
          a need — the grid is the training needs analysis.
        </p>
        {!readOnly && (
          <button onClick={() => setForm({ ...emptyModule, sort_order: modules.length })}
            className="bg-[#E8913A] text-white text-xs font-semibold px-3 py-1.5 rounded-lg hover:bg-[#d07e2e] transition-colors shrink-0">
            + Module
          </button>
        )}
      </div>

      {error && <div className="mb-3 text-[12px] text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">{error}</div>}

      {demand.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
          <div className="bg-slate-50 rounded-xl p-3">
            <p className="text-[10px] text-slate-400 uppercase tracking-widest">Training places</p>
            <p className="text-xl font-semibold text-slate-800">{summary.places.toLocaleString()}</p>
            {/* Places, not people — one person on three modules needs three seats, and
                that is the number that decides how many sessions get run. */}
            <p className="text-[10px] text-slate-400 mt-0.5">mandatory seats to deliver</p>
          </div>
          <div className="bg-slate-50 rounded-xl p-3">
            <p className="text-[10px] text-slate-400 uppercase tracking-widest">Demand unknown</p>
            <p className={`text-xl font-semibold ${summary.unsizedNeeds ? 'text-amber-600' : 'text-slate-800'}`}>{summary.unsizedNeeds}</p>
            {/* The unsized groups are named, because a places total that quietly omits
                them is worse than no total: nobody thinks to question it. */}
            {summary.unsizedGroups.length > 0 && (
              <p className="text-[10px] text-amber-600 mt-0.5 truncate" title={summary.unsizedGroups.join(', ')}>
                {summary.unsizedGroups.join(', ')}
              </p>
            )}
          </div>
          <div className="bg-slate-50 rounded-xl p-3">
            <p className="text-[10px] text-slate-400 uppercase tracking-widest">Modules</p>
            <p className="text-xl font-semibold text-slate-800">{modules.length}</p>
          </div>
          <div className="bg-slate-50 rounded-xl p-3">
            <p className="text-[10px] text-slate-400 uppercase tracking-widest">Not yet ready</p>
            <p className={`text-xl font-semibold ${summary.notReadyModules.length ? 'text-amber-600' : 'text-slate-800'}`}>{summary.notReadyModules.length}</p>
            <p className="text-[10px] text-slate-400 mt-0.5">material still in build</p>
          </div>
        </div>
      )}

      {/* ── The matrix ─────────────────────────────────────────────────────── */}
      <div className="bg-white border border-slate-100 rounded-2xl p-4 overflow-x-auto">
        {modules.length === 0 ? (
          <div className="text-center py-8">
            <p className="text-slate-400 text-sm">No training modules yet.</p>
            <p className="text-slate-300 text-xs mt-1">Add what people need to be able to do — “New Billing Console”, “Single Customer View”.</p>
          </div>
        ) : audiences.length === 0 ? (
          <div className="text-center py-8">
            <p className="text-slate-400 text-sm">No audiences yet.</p>
            <p className="text-slate-300 text-xs mt-1">Add audiences first — the matrix needs groups to train.</p>
          </div>
        ) : (
          <table className="w-full border-collapse">
            <thead>
              <tr>
                <th className="text-left text-[10px] text-slate-400 uppercase tracking-widest font-semibold pb-2 pr-3 align-bottom sticky left-0 bg-white">Audience</th>
                {matrix.cols.map(c => {
                  const st = STATUS_STYLE[c.status] ?? STATUS_STYLE.planned
                  return (
                    <th key={c.id} className="pb-2 px-1 align-bottom" style={{ minWidth: 92 }}>
                      <button onClick={() => !readOnly && setForm({ ...emptyModule, ...modules.find(m => m.id === c.id),
                          duration_min: modules.find(m => m.id === c.id)?.duration_min ?? '',
                          delivery: modules.find(m => m.id === c.id)?.delivery ?? '',
                          owner_name: modules.find(m => m.id === c.id)?.owner_name ?? '',
                          ready_on: modules.find(m => m.id === c.id)?.ready_on ?? '',
                          window_start: modules.find(m => m.id === c.id)?.window_start ?? '',
                          window_end: modules.find(m => m.id === c.id)?.window_end ?? '',
                          notes: modules.find(m => m.id === c.id)?.notes ?? '' })}
                        className="text-left w-full group" disabled={readOnly}>
                        <p className="text-[11px] font-semibold text-slate-700 leading-tight group-hover:text-[#1F4E79]">{c.name}</p>
                        <p className={`text-[9px] mt-0.5 flex items-center gap-1 ${st.text}`}>
                          <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: st.dot }} />
                          {/* Status sits on the column header because a module still in
                              build explains a whole column of zeros later — that is not
                              leaders failing to act, and the two must not look alike. */}
                          {MODULE_STATUS_LABEL[c.status] ?? '—'}
                        </p>
                        <p className="text-[9px] text-slate-400">{DELIVERY_LABEL[c.delivery] ?? ''}</p>
                      </button>
                    </th>
                  )
                })}
              </tr>
            </thead>
            <tbody>
              {matrix.rows.map((r, ri) => (
                <tr key={r.id} className="border-t border-slate-50">
                  <td className="py-2 pr-3 sticky left-0 bg-white">
                    <p className="text-sm font-semibold text-slate-800 whitespace-nowrap">{r.name}</p>
                    <p className="text-[10px] text-slate-400">
                      {r.headcount == null
                        ? <span className="text-amber-600">size unknown</span>
                        : `${r.headcount} people`}
                    </p>
                  </td>
                  {matrix.cols.map((c, ci) => {
                    const need = matrix.cells[ri][ci]
                    return (
                      <td key={c.id} className="py-2 px-1 text-center">
                        <button onClick={() => openCell(r, c, need)} disabled={readOnly}
                          title={need
                            ? `${need.necessity === 'mandatory' ? 'Mandatory' : 'Recommended'}${need.partial ? ' · part of the group' : ''}${need.notes ? ` · ${need.notes}` : ''}`
                            : 'Not required — click to add'}
                          className={`w-full rounded-lg py-1.5 text-[11px] font-semibold transition-colors ${
                            !need ? 'text-slate-200 hover:bg-slate-50 hover:text-slate-400'
                              : need.unknown ? 'bg-amber-50 text-amber-700'
                              : need.necessity === 'mandatory' ? 'bg-[#1F4E79]/10 text-[#1F4E79]'
                              : 'bg-slate-100 text-slate-500'}`}>
                          {!need ? '·'
                            // Never 0: an unsized group needing this module is unknown
                            // demand, and a 0 would read as nobody needing it.
                            : need.unknown ? '?'
                            : need.needed}
                          {need?.partial && <span className="block text-[8px] font-normal opacity-70">of {r.headcount ?? '?'}</span>}
                          {need?.necessity === 'recommended' && <span className="block text-[8px] font-normal opacity-70">rec.</span>}
                        </button>
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {modules.length > 0 && audiences.length > 0 && (
          <div className="flex items-center gap-4 mt-4 pt-3 border-t border-slate-50 text-[10px] text-slate-400 flex-wrap">
            <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-[#1F4E79]/10" /> Mandatory</span>
            <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-slate-100" /> Recommended</span>
            <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-amber-50" /> Needed, size unknown</span>
            <span className="flex items-center gap-1.5"><span className="text-slate-200 font-semibold">·</span> Not required</span>
          </div>
        )}
      </div>

      {/* ── Module editor ──────────────────────────────────────────────────── */}
      {form && (
        <>
          <div className="fixed inset-0 bg-black/40 z-40" onClick={() => setForm(null)} />
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 pointer-events-none">
            <div className="bg-white rounded-2xl shadow-2xl pointer-events-auto w-full max-w-md max-h-[90vh] overflow-y-auto">
              <div className="px-6 py-5 border-b border-slate-100 flex items-center justify-between">
                <h3 className="font-bold text-slate-800">{form.id ? 'Edit module' : 'New module'}</h3>
                <button onClick={() => setForm(null)} className="w-7 h-7 rounded-full bg-slate-100 flex items-center justify-center text-slate-500 text-xs">✕</button>
              </div>
              <div className="px-6 py-5 space-y-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">Name *</label>
                  <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} autoFocus
                    placeholder="e.g. New Billing Console — core"
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#1F4E79]" />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-slate-600 mb-1">Delivery</label>
                    <select value={form.delivery} onChange={e => setForm({ ...form, delivery: e.target.value })}
                      className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:border-[#1F4E79]">
                      <option value="">—</option>
                      {Object.entries(DELIVERY_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                    </select>
                    <p className="text-[10px] text-slate-400 mt-1">Decides what a gap costs to close.</p>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-600 mb-1">Duration (min)</label>
                    <input type="number" min="1" value={form.duration_min}
                      onChange={e => setForm({ ...form, duration_min: e.target.value })}
                      className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#1F4E79]" />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-slate-600 mb-1">Status</label>
                    <select value={form.status} onChange={e => setForm({ ...form, status: e.target.value })}
                      className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:border-[#1F4E79]">
                      {Object.entries(MODULE_STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-600 mb-1">Material ready on</label>
                    <input type="date" value={form.ready_on ?? ''} onChange={e => setForm({ ...form, ready_on: e.target.value })}
                      className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#1F4E79]" />
                  </div>
                </div>
                <p className="text-[10px] text-slate-400 -mt-2">
                  A module still in build explains low coverage later. Without this, a leader looks like they haven’t acted.
                </p>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-slate-600 mb-1">Delivery from</label>
                    <input type="date" value={form.window_start ?? ''} onChange={e => setForm({ ...form, window_start: e.target.value })}
                      className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#1F4E79]" />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-600 mb-1">Delivery to</label>
                    <input type="date" value={form.window_end ?? ''} onChange={e => setForm({ ...form, window_end: e.target.value })}
                      className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#1F4E79]" />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">Built and run by</label>
                  <input value={form.owner_name} onChange={e => setForm({ ...form, owner_name: e.target.value })}
                    placeholder="e.g. L. Fraser"
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#1F4E79]" />
                  <p className="text-[10px] text-slate-400 mt-1">Different from the audience owner, who reports how their team is tracking.</p>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">Notes</label>
                  <input value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })}
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#1F4E79]" />
                </div>
              </div>
              <div className="px-6 py-4 border-t border-slate-100 flex items-center gap-3">
                {/* Delete lives inside the dialog, not next to Edit on the row — that
                    arrangement lost a swimlane once. */}
                {form.id && !readOnly && (
                  <button onClick={() => removeModule(form)} className="text-sm text-red-500 hover:underline mr-auto">Delete</button>
                )}
                <button onClick={() => setForm(null)} className="text-sm text-slate-500 px-4 py-2 ml-auto">Cancel</button>
                <button onClick={saveModule} disabled={saving || !form.name.trim()}
                  className="bg-[#1F4E79] text-white text-sm font-semibold px-6 py-2 rounded-lg hover:bg-[#163a5c] transition-colors disabled:opacity-60">
                  {saving ? 'Saving…' : form.id ? 'Save' : 'Add'}
                </button>
              </div>
            </div>
          </div>
        </>
      )}

      {/* ── Cell editor ────────────────────────────────────────────────────── */}
      {cell && (
        <>
          <div className="fixed inset-0 bg-black/40 z-40" onClick={() => setCell(null)} />
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 pointer-events-none">
            <div className="bg-white rounded-2xl shadow-2xl pointer-events-auto w-full max-w-sm">
              <div className="px-6 py-5 border-b border-slate-100">
                <h3 className="font-bold text-slate-800 text-sm">{cell.audience}</h3>
                <p className="text-xs text-slate-500 mt-0.5">needs <strong>{cell.module}</strong></p>
              </div>
              <div className="px-6 py-5 space-y-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">Necessity</label>
                  <select value={cell.necessity} onChange={e => setCell({ ...cell, necessity: e.target.value })}
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:border-[#1F4E79]">
                    <option value="mandatory">Mandatory</option>
                    <option value="recommended">Recommended</option>
                  </select>
                  <p className="text-[10px] text-slate-400 mt-1">Mandatory gaps block the readiness gate. Recommended ones don’t.</p>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">How many of the group</label>
                  <input type="number" min="0" value={cell.applies_to}
                    onChange={e => setCell({ ...cell, applies_to: e.target.value })}
                    placeholder={cell.headcount == null ? 'group size unknown' : `all ${cell.headcount}`}
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#1F4E79]" />
                  <p className="text-[10px] text-slate-400 mt-1">
                    Leave blank for the whole group. Set it only when part of the group needs this — 30 of 180 who do refunds.
                  </p>
                </div>
              </div>
              <div className="px-6 py-4 border-t border-slate-100 flex items-center gap-3">
                {cell.need_id && (
                  <button onClick={() => saveCell(null)} disabled={saving}
                    className="text-sm text-red-500 hover:underline mr-auto">Not required</button>
                )}
                <button onClick={() => setCell(null)} className="text-sm text-slate-500 px-4 py-2 ml-auto">Cancel</button>
                <button onClick={() => saveCell({ necessity: cell.necessity, applies_to: cell.applies_to === '' ? null : Number(cell.applies_to) })}
                  disabled={saving}
                  className="bg-[#1F4E79] text-white text-sm font-semibold px-5 py-2 rounded-lg hover:bg-[#163a5c] transition-colors disabled:opacity-60">
                  {saving ? 'Saving…' : 'Save'}
                </button>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
