import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { LV_LABEL, HEAT_DOMAINS, overallImpact } from '../lib/ai/analysis'

// Impact colours match the heat map exactly — the same rating must not look like two
// different things depending on which screen you are on.
const LV_DOT = { vh: '#991B1B', h: '#DC2626', m: '#E8913A', l: '#16A34A', vl: '#86EFAC', none: '#E2E8F0' }
const LEVELS = ['none', 'vl', 'l', 'm', 'h', 'vh']   // ascending: a scale, not a ranking

const empty = { name: '', headcount: '', owner_name: '', notes: '', parent_id: '',
  impact_people: '', impact_process: '', impact_information: '', impact_technology: '', impact_note: '' }

export default function ProjectAudiences({ project, readOnly = false }) {
  const [rows, setRows]       = useState([])
  const [loading, setLoading] = useState(true)
  const [form, setForm]       = useState(null)
  const [saving, setSaving]   = useState(false)
  const [error, setError]     = useState(null)

  useEffect(() => { if (project?.id) load() /* eslint-disable-next-line */ }, [project?.id])

  async function load({ quiet = false } = {}) {
    if (!quiet) setLoading(true)
    const { data, error: err } = await supabase.from('audiences')
      .select('*').eq('project_id', project.id).order('sort_order')
    if (err) setError(err.message)
    setRows(data ?? [])
    setLoading(false)
  }

  async function save() {
    if (!form.name.trim()) return
    setSaving(true); setError(null)
    const payload = {
      project_id: project.id,
      name: form.name.trim(),
      // '' from an empty number input must become NULL, not 0. A group whose size
      // nobody knows is not a group of nobody — and 0 would make every coverage
      // percentage that divides by it silently wrong.
      headcount: form.headcount === '' || form.headcount === null ? null : Number(form.headcount),
      owner_name: form.owner_name?.trim() || null,
      parent_id: form.parent_id || null,
      notes: form.notes?.trim() || null,
      sort_order: form.sort_order ?? rows.length,
      impact_people:      form.impact_people || null,
      impact_process:     form.impact_process || null,
      impact_information: form.impact_information || null,
      impact_technology:  form.impact_technology || null,
      impact_note:        form.impact_note?.trim() || null,
    }
    // Stamp the rating date only when a rating exists, so an unrated audience never
    // looks like it was assessed and found to have no impact.
    const anyRated = HEAT_DOMAINS.some(d => payload[d.key])
    payload.impact_rated_on = anyRated ? (form.impact_rated_on ?? new Date().toISOString().slice(0, 10)) : null
    const q = form.id
      ? supabase.from('audiences').update(payload).eq('id', form.id).select('id')
      : supabase.from('audiences').insert(payload).select('id')
    const { data, error: err } = await q
    setSaving(false)
    if (err || !data?.length) { setError(err?.message ?? 'Could not save.'); return }
    setForm(null)
    load({ quiet: true })
  }

  async function remove(a) {
    if (!window.confirm(`Delete “${a.name}”? Anything scoped to this audience keeps its data but loses the link.`)) return
    const { error: err } = await supabase.from('audiences').delete().eq('id', a.id)
    if (err) { setError(err.message); return }
    load({ quiet: true })
  }

  const tops = rows.filter(r => !r.parent_id)
  const kids = id => rows.filter(r => r.parent_id === id)
  const sized = rows.filter(r => r.headcount != null)
  const totalPeople = sized.reduce((s, r) => s + r.headcount, 0)
  const unsized = rows.length - sized.length
  const unowned = rows.filter(r => !r.owner_name && !r.owner_id).length

  const Row = ({ a, nested = false }) => (
    <div className="flex items-center gap-3 py-2.5 border-b border-slate-50 group" style={{ paddingLeft: nested ? 22 : 0 }}>
      {/* The overall dot is the PEAK of the four domains, computed. It used to be a
          separately stored field, which let a row contradict itself — an overall of
          "not rated" beside three High domains. */}
      {(() => {
        const peak = overallImpact(a)
        return <span className="w-2.5 h-2.5 rounded-full shrink-0"
          title={peak ? `Overall: ${LV_LABEL[peak]} (highest of the four domains)` : 'Not rated'}
          style={{ background: peak ? LV_DOT[peak] : 'transparent', border: peak ? 'none' : '1px solid #E2E8F0' }} />
      })()}
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-slate-800 truncate">
          {nested && <span className="text-slate-300 mr-1">↳</span>}{a.name}
        </p>
        {a.notes && <p className="text-[11px] text-slate-400 truncate">{a.notes}</p>}
      </div>
      <div className="hidden sm:flex items-center gap-1.5 w-24 shrink-0 justify-center" title="People · Process · Information · Technology">
        {HEAT_DOMAINS.map(d => (
          <span key={d.key} className="w-2 h-2 rounded-full"
            title={`${d.label}: ${LV_LABEL[a[d.key]] ?? 'not rated'}`}
            style={{ background: a[d.key] ? (LV_DOT[a[d.key]] ?? '#E2E8F0') : 'transparent',
                     border: a[d.key] ? 'none' : '1px solid #E2E8F0' }} />
        ))}
      </div>
      <div className="w-24 text-right shrink-0">
        {a.headcount == null
          // Amber, not a dash: an unknown size is a gap someone should close, and it
          // stops coverage being computable for this group.
          ? <span className="text-[11px] text-amber-600">size unknown</span>
          : <span className="text-sm text-slate-700">{a.headcount}</span>}
      </div>
      <div className="w-36 text-right shrink-0 text-[12px]">
        {a.owner_name || a.owner_id
          ? <span className="text-slate-600">{a.owner_name ?? 'assigned'}</span>
          : <span className="text-amber-600">no owner</span>}
      </div>
      {!readOnly && (
        <div className="w-20 text-right shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
          <button onClick={() => setForm({ ...empty, ...a, headcount: a.headcount ?? '', owner_name: a.owner_name ?? '', notes: a.notes ?? '', parent_id: a.parent_id ?? '',
              impact_people: a.impact_people ?? '', impact_process: a.impact_process ?? '',
              impact_information: a.impact_information ?? '', impact_technology: a.impact_technology ?? '',
              impact_note: a.impact_note ?? '' })}
            className="text-[11px] text-[#1F4E79] hover:underline">Edit</button>
          <button onClick={() => remove(a)} className="text-[11px] text-red-400 hover:underline ml-2">Del</button>
        </div>
      )}
    </div>
  )

  if (loading) return <div className="h-40 bg-slate-100 rounded-2xl animate-pulse" />

  return (
    <div>
      <div className="flex items-start justify-between mb-4 gap-3 flex-wrap">
        <p className="text-xs text-slate-500 max-w-xl">
          The groups this change lands on for <strong>{project.name}</strong>. Each needs a size and
          someone who speaks for it — that owner is who gets asked how training is going.
        </p>
        {!readOnly && (
          <button onClick={() => setForm({ ...empty, sort_order: rows.length })}
            className="bg-[#E8913A] text-white text-xs font-semibold px-3 py-1.5 rounded-lg hover:bg-[#d07e2e] transition-colors shrink-0">
            + Audience
          </button>
        )}
      </div>

      {error && (
        <div className="mb-3 text-[12px] text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">{error}</div>
      )}

      {rows.length > 0 && (
        <div className="grid grid-cols-3 gap-3 mb-4">
          <div className="bg-slate-50 rounded-xl p-3">
            <p className="text-[10px] text-slate-400 uppercase tracking-widest">People covered</p>
            <p className="text-xl font-semibold text-slate-800">{totalPeople}</p>
            {/* The total is only across sized groups — saying so stops it being read as
                the whole population when some groups have no headcount. */}
            {unsized > 0 && <p className="text-[10px] text-amber-600 mt-0.5">across {sized.length} of {rows.length} groups</p>}
          </div>
          <div className="bg-slate-50 rounded-xl p-3">
            <p className="text-[10px] text-slate-400 uppercase tracking-widest">Size unknown</p>
            <p className={`text-xl font-semibold ${unsized ? 'text-amber-600' : 'text-slate-800'}`}>{unsized}</p>
          </div>
          <div className="bg-slate-50 rounded-xl p-3">
            <p className="text-[10px] text-slate-400 uppercase tracking-widest">No owner</p>
            <p className={`text-xl font-semibold ${unowned ? 'text-amber-600' : 'text-slate-800'}`}>{unowned}</p>
          </div>
        </div>
      )}

      <div className="bg-white border border-slate-100 rounded-2xl p-4">
        {rows.length === 0 ? (
          <div className="text-center py-8">
            <p className="text-slate-400 text-sm">No audiences yet.</p>
            <p className="text-slate-300 text-xs mt-1">Add the groups this change affects — Billing Operations, Contact Centre, and so on.</p>
          </div>
        ) : (
          <>
            <div className="flex items-center gap-3 pb-2 text-[10px] text-slate-400 uppercase tracking-widest border-b border-slate-100">
              <span className="w-2.5 shrink-0" />
              <span className="flex-1">Audience</span>
              <span className="hidden sm:block w-24 text-center shrink-0">Impact</span>
              <span className="w-24 text-right shrink-0">Headcount</span>
              <span className="w-36 text-right shrink-0">Owner</span>
              {!readOnly && <span className="w-20 shrink-0" />}
            </div>
            {tops.map(a => (
              <div key={a.id}>
                <Row a={a} />
                {kids(a.id).map(k => <Row key={k.id} a={k} nested />)}
              </div>
            ))}
          </>
        )}
      </div>

      {form && (
        <>
          <div className="fixed inset-0 bg-black/40 z-40" onClick={() => setForm(null)} />
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 pointer-events-none">
            <div className="bg-white rounded-2xl shadow-2xl pointer-events-auto w-full max-w-md">
              <div className="px-6 py-5 border-b border-slate-100 flex items-center justify-between">
                <h3 className="font-bold text-slate-800">{form.id ? 'Edit audience' : 'New audience'}</h3>
                <button onClick={() => setForm(null)} className="w-7 h-7 rounded-full bg-slate-100 flex items-center justify-center text-slate-500 text-xs">✕</button>
              </div>
              <div className="px-6 py-5 space-y-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">Name *</label>
                  <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} autoFocus
                    placeholder="e.g. Contact Centre"
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#1F4E79]" />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">Headcount</label>
                  <input type="number" min="0" value={form.headcount}
                    onChange={e => setForm({ ...form, headcount: e.target.value })}
                    placeholder="leave blank if unknown"
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#1F4E79]" />
                  <p className="text-[10px] text-slate-400 mt-1">Blank stays “unknown”. Don’t enter 0 — that reads as a group with nobody in it.</p>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">Owner — the people-leader for this group</label>
                  <input value={form.owner_name} onChange={e => setForm({ ...form, owner_name: e.target.value })}
                    placeholder="e.g. S. Whitcombe"
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#1F4E79]" />
                  <p className="text-[10px] text-slate-400 mt-1">This is who gets asked how their team is tracking. A group with no owner can’t be reported on.</p>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">Rolls up to</label>
                  <select value={form.parent_id} onChange={e => setForm({ ...form, parent_id: e.target.value })}
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:border-[#1F4E79]">
                    <option value="">— top level —</option>
                    {tops.filter(t => t.id !== form.id).map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                  </select>
                </div>

                <div className="border-t border-slate-100 pt-4">
                  <label className="block text-xs font-semibold text-slate-600 mb-1">Impact by domain</label>
                  <p className="text-[10px] text-slate-400 mb-2">These four ratings are the stakeholder heat map. Leave a domain blank if it hasn’t been assessed — blank is reported as a gap, not as “no impact”.</p>
                  <div className="grid grid-cols-2 gap-2">
                    {HEAT_DOMAINS.map(d => (
                      <div key={d.key}>
                        <label className="block text-[10px] text-slate-500 mb-0.5">{d.label}</label>
                        <select value={form[d.key] ?? ''} onChange={e => setForm({ ...form, [d.key]: e.target.value })}
                          className="w-full border border-slate-200 rounded-lg px-2 py-1.5 text-[13px] bg-white focus:outline-none focus:border-[#1F4E79]">
                          <option value="">Not rated</option>
                          {[...LEVELS].reverse().map(k => <option key={k} value={k}>{LV_LABEL[k]}</option>)}
                        </select>
                      </div>
                    ))}
                  </div>
                  <input value={form.impact_note ?? ''} onChange={e => setForm({ ...form, impact_note: e.target.value })}
                    placeholder="Why is it rated this way? (appears on the heat map)"
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm mt-2 focus:outline-none focus:border-[#1F4E79]" />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">Notes</label>
                  <input value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })}
                    placeholder="What changes for this group?"
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#1F4E79]" />
                </div>
              </div>
              <div className="px-6 py-4 border-t border-slate-100 flex justify-end gap-3">
                <button onClick={() => setForm(null)} className="text-sm text-slate-500 px-4 py-2">Cancel</button>
                <button onClick={save} disabled={saving || !form.name.trim()}
                  className="bg-[#1F4E79] text-white text-sm font-semibold px-6 py-2 rounded-lg hover:bg-[#163a5c] transition-colors disabled:opacity-60">
                  {saving ? 'Saving…' : form.id ? 'Save' : 'Add'}
                </button>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
