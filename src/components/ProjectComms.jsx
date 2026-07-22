import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'

// The comms plan reads from comms_schedule (dates and statuses derived there) but writes
// to comms_items. One source for the status means the screen, the report and CORA cannot
// disagree about whether a message is blocked or merely late.

const STATUS_STYLE = {
  sent:        { dot: '#16A34A', label: 'Sent' },
  planned:     { dot: '#94A3B8', label: 'Planned' },
  blocked:     { dot: '#DC2626', label: 'Blocked' },
  overdue:     { dot: '#E8913A', label: 'Overdue' },
  unscheduled: { dot: '#CBD5E1', label: 'Unscheduled' },
}

const emptyForm = {
  message: '', audience: '', size: '', channel: '', owner_name: '',
  anchor_milestone_id: '', offset_days: '0', fixed_date: '',
  depends_on_milestone_id: '', override_date: '', sent: false, sent_on: '',
}

const fmt = d => d ? new Date(d + 'T00:00:00').toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '—'

export default function ProjectComms({ project, readOnly = false }) {
  const [rows, setRows]           = useState([])   // from comms_schedule (derived)
  const [milestones, setMilestones] = useState([]) // for anchor / dependency pickers
  const [loading, setLoading]     = useState(true)
  const [form, setForm]           = useState(null)
  const [saving, setSaving]       = useState(false)
  const [error, setError]         = useState(null)

  useEffect(() => { if (project?.id) load() /* eslint-disable-next-line */ }, [project?.id])

  async function load() {
    setLoading(true)
    const [{ data: sched, error: e1 }, { data: ms }] = await Promise.all([
      supabase.from('comms_schedule').select('*').eq('project_id', project.id)
        .order('effective_date', { ascending: true, nullsFirst: false }),
      supabase.from('project_milestones').select('id, name, lane, milestone_date, starts_on, ends_on')
        .eq('project_id', project.id).order('sort_order'),
    ])
    if (e1) setError(e1.message)
    setRows(sched ?? [])
    setMilestones(ms ?? [])
    setLoading(false)
  }

  async function save() {
    if (!form.message.trim()) return
    // A milestone anchor OR a fixed date — the table's CHECK enforces this, but catching
    // it here gives a sentence instead of a constraint violation.
    if (!form.anchor_milestone_id && !form.fixed_date) {
      setError('Anchor the message to a milestone, or give it a fixed date.'); return
    }
    setSaving(true); setError(null)
    const payload = {
      project_id: project.id,
      message: form.message.trim(),
      audience: form.audience?.trim() || null,
      // '' → NULL, never 0: a message whose reach nobody knows is not a message to nobody.
      size: form.size === '' ? null : Number(form.size),
      channel: form.channel?.trim() || null,
      owner_name: form.owner_name?.trim() || null,
      anchor_milestone_id: form.anchor_milestone_id || null,
      offset_days: form.anchor_milestone_id ? Number(form.offset_days || 0) : 0,
      fixed_date: form.anchor_milestone_id ? null : (form.fixed_date || null),
      override_date: form.override_date || null,
      depends_on_milestone_id: form.depends_on_milestone_id || null,
      sent: !!form.sent,
      sent_on: form.sent ? (form.sent_on || new Date().toISOString().slice(0, 10)) : null,
      sort_order: form.sort_order ?? rows.length,
    }
    const q = form.id
      ? supabase.from('comms_items').update(payload).eq('id', form.id)
      : supabase.from('comms_items').insert(payload)
    const { error: err } = await q
    setSaving(false)
    if (err) { setError(err.message); return }
    setForm(null)
    await load()
  }

  async function remove(id) {
    if (!window.confirm('Delete this communication?')) return
    await supabase.from('comms_items').delete().eq('id', id)
    await load()
  }

  // "Accept the move" — clear the override so the item tracks its anchor again.
  async function reAnchor(id) {
    await supabase.from('comms_items').update({ override_date: null }).eq('id', id)
    await load()
  }

  async function toggleSent(row) {
    await supabase.from('comms_items').update({
      sent: !row.sent, sent_on: !row.sent ? new Date().toISOString().slice(0, 10) : null,
    }).eq('id', row.id)
    await load()
  }

  function openEdit(r) {
    setForm({
      id: r.id, message: r.message ?? '', audience: r.audience ?? '', size: r.size ?? '',
      channel: r.channel ?? '', owner_name: r.owner_name ?? '',
      anchor_milestone_id: r.anchor_milestone_id ?? '', offset_days: String(r.offset_days ?? 0),
      fixed_date: r.fixed_date ?? '', override_date: r.override_date ?? '',
      depends_on_milestone_id: r.depends_on_milestone_id ?? '',
      sent: !!r.sent, sent_on: r.sent_on ?? '', sort_order: r.sort_order,
    })
  }

  const counts = rows.reduce((a, r) => { a[r.derived_status] = (a[r.derived_status] || 0) + 1; return a }, {})

  if (loading) return <p className="text-sm text-slate-400 py-8">Loading comms plan…</p>

  return (
    <div>
      {/* Summary strip — the two failure modes kept apart */}
      <div className="flex flex-wrap gap-2 mb-4">
        {['sent', 'planned', 'overdue', 'blocked', 'unscheduled'].map(s => counts[s] ? (
          <span key={s} className="inline-flex items-center gap-1.5 text-xs font-medium bg-white border border-slate-200 rounded-full px-3 py-1">
            <span className="w-2 h-2 rounded-full" style={{ background: STATUS_STYLE[s].dot }} />
            {counts[s]} {STATUS_STYLE[s].label.toLowerCase()}
          </span>
        ) : null)}
        {!readOnly && (
          <button onClick={() => setForm({ ...emptyForm })}
            className="ml-auto text-xs font-semibold bg-[#1F4E79] text-white px-3 py-1.5 rounded-lg hover:bg-[#163a5c]">
            + Add communication
          </button>
        )}
      </div>

      {error && <p className="text-xs text-red-600 mb-3">{error}</p>}

      {rows.length === 0 ? (
        <div className="text-center py-10 bg-slate-50 rounded-2xl border border-slate-100">
          <p className="text-slate-400 text-sm">No communications planned yet.</p>
          <p className="text-slate-300 text-xs mt-1">Anchor each message to a milestone so the whole cascade moves when go-live moves.</p>
        </div>
      ) : (
        <div className="space-y-1.5">
          {rows.map(r => {
            const st = STATUS_STYLE[r.derived_status] ?? STATUS_STYLE.planned
            return (
              <div key={r.id} className="flex items-center gap-3 bg-white border border-slate-200 rounded-xl px-4 py-2.5">
                <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: st.dot }} title={st.label} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="font-semibold text-sm text-slate-800">{r.message}</p>
                    {r.detached && <span className="text-[10px] font-semibold text-amber-600 bg-amber-50 px-1.5 py-0.5 rounded">revised off anchor</span>}
                  </div>
                  <p className="text-xs text-slate-400 mt-0.5">
                    {r.audience ?? '—'}{r.size ? ` · ${r.size}` : ''} · {r.channel ?? '—'} · {r.owner_name ?? 'no owner'}
                  </p>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-xs font-medium text-slate-600">{fmt(r.effective_date)}</p>
                  <p className="text-[10px] text-slate-400">
                    {r.derived_status === 'blocked' ? `blocked on ${r.depends_name ?? 'upstream'}`
                      : r.anchor_name ? `${r.anchor_name}${r.offset_days ? ` ${r.offset_days > 0 ? '+' : ''}${r.offset_days}d` : ''}`
                      : 'fixed date'}
                  </p>
                </div>
                {!readOnly && (
                  <div className="flex gap-1.5 shrink-0">
                    <button onClick={() => toggleSent(r)} className="text-[11px] text-slate-400 hover:text-[#1F4E79]" title="Toggle sent">
                      {r.sent ? 'Unsend' : 'Sent'}
                    </button>
                    {r.detached && <button onClick={() => reAnchor(r.id)} className="text-[11px] text-amber-600 hover:underline" title="Re-track the milestone">Re-anchor</button>}
                    <button onClick={() => openEdit(r)} className="text-[11px] text-slate-400 hover:text-[#1F4E79]">Edit</button>
                    <button onClick={() => remove(r.id)} className="text-[11px] text-red-400 hover:text-red-600">Del</button>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* Editor */}
      {form && (
        <>
          <div className="fixed inset-0 bg-black/40 z-40" onClick={() => setForm(null)} />
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 pointer-events-none">
            <div className="bg-white rounded-2xl shadow-2xl pointer-events-auto w-full max-w-lg max-h-[90vh] overflow-y-auto">
              <div className="px-5 py-4 border-b border-slate-100">
                <p className="font-semibold text-slate-800">{form.id ? 'Edit communication' : 'New communication'}</p>
              </div>
              <div className="p-5 space-y-3">
                <Field label="Message"><input value={form.message} onChange={e => setForm({ ...form, message: e.target.value })} className={inp} placeholder="What is being communicated" /></Field>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Audience"><input value={form.audience} onChange={e => setForm({ ...form, audience: e.target.value })} className={inp} /></Field>
                  <Field label="Headcount"><input type="number" value={form.size} onChange={e => setForm({ ...form, size: e.target.value })} className={inp} placeholder="—" /></Field>
                  <Field label="Channel"><input value={form.channel} onChange={e => setForm({ ...form, channel: e.target.value })} className={inp} placeholder="Email, briefing…" /></Field>
                  <Field label="Owner"><input value={form.owner_name} onChange={e => setForm({ ...form, owner_name: e.target.value })} className={inp} placeholder="Who sends it" /></Field>
                </div>

                {/* Anchoring */}
                <div className="bg-slate-50 rounded-xl p-3 space-y-3">
                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">When it goes</p>
                  <Field label="Anchor to milestone">
                    <select value={form.anchor_milestone_id} onChange={e => setForm({ ...form, anchor_milestone_id: e.target.value })} className={inp}>
                      <option value="">— fixed date instead —</option>
                      {milestones.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
                    </select>
                  </Field>
                  {form.anchor_milestone_id ? (
                    <Field label="Offset (days from the milestone; negative = before)">
                      <input type="number" value={form.offset_days} onChange={e => setForm({ ...form, offset_days: e.target.value })} className={inp} />
                    </Field>
                  ) : (
                    <Field label="Fixed date">
                      <input type="date" value={form.fixed_date} onChange={e => setForm({ ...form, fixed_date: e.target.value })} className={inp} />
                    </Field>
                  )}
                  {form.anchor_milestone_id && (
                    <Field label="Override date (revise — pins it off the anchor; leave blank to track the milestone)">
                      <input type="date" value={form.override_date} onChange={e => setForm({ ...form, override_date: e.target.value })} className={inp} />
                    </Field>
                  )}
                </div>

                {/* Dependency */}
                <Field label="Waits on (upstream output — blocks it if not reached)">
                  <select value={form.depends_on_milestone_id} onChange={e => setForm({ ...form, depends_on_milestone_id: e.target.value })} className={inp}>
                    <option value="">— nothing —</option>
                    {milestones.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
                  </select>
                </Field>

                <label className="flex items-center gap-2 text-sm text-slate-600">
                  <input type="checkbox" checked={form.sent} onChange={e => setForm({ ...form, sent: e.target.checked })} />
                  Already sent
                </label>
              </div>
              <div className="px-5 py-4 border-t border-slate-100 flex justify-end gap-2">
                <button onClick={() => setForm(null)} className="text-sm text-slate-500 px-4 py-2 hover:text-slate-700">Cancel</button>
                <button onClick={save} disabled={saving} className="text-sm font-semibold bg-[#1F4E79] text-white px-4 py-2 rounded-lg hover:bg-[#163a5c] disabled:opacity-50">
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

const inp = 'w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#1F4E79]'
function Field({ label, children }) {
  return (
    <label className="block">
      <span className="block text-[11px] font-medium text-slate-500 mb-1">{label}</span>
      {children}
    </label>
  )
}
