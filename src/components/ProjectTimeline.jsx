import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'

const PHASES = [1, 2, 3, 4, 5]
const PHASE_NAMES = { 1: 'Diagnose', 2: 'Design', 3: 'Engage', 4: 'Embed', 5: 'Evaluate' }
const STATUS = {
  completed: { fill: '#16a34a', track: '#16a34a', text: '#fff' },
  active:    { fill: '#E8913A', track: '#fde3c6', text: '#fff' },
  locked:    { fill: '#e2e8f0', track: '#e2e8f0', text: '#475569' },
}
const MONTHW = 90

const toDate = s => (s ? new Date(s + 'T00:00:00') : null)
const iso    = d => d.toISOString().slice(0, 10)
const monthFloor = d => new Date(d.getFullYear(), d.getMonth(), 1)
const monthCeil  = d => new Date(d.getFullYear(), d.getMonth() + 1, 1)
const fmtShort   = d => d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })

const emptyMs = { name: '', lane: 'delivery', kind: 'point', milestone_date: '', starts_on: '', ends_on: '' }

export default function ProjectTimeline({ project, readOnly = false }) {
  const [phases,      setPhases]      = useState([])   // 5 rows (some may be unsaved)
  const [milestones,  setMilestones]  = useState([])
  const [progress,    setProgress]    = useState({})   // { phase: {done,total} }
  const [loading,     setLoading]     = useState(true)
  const [savingDates, setSavingDates] = useState(false)
  const [msForm,      setMsForm]      = useState(null)  // milestone being added/edited
  const [msSaving,    setMsSaving]    = useState(false)

  useEffect(() => { if (project?.id) load() /* eslint-disable-next-line */ }, [project?.id])

  async function load() {
    setLoading(true)
    const [{ data: ph }, { data: ms }] = await Promise.all([
      supabase.from('project_phases').select('*').eq('project_id', project.id).order('phase_number'),
      supabase.from('project_milestones').select('*').eq('project_id', project.id).order('milestone_date'),
    ])
    const byNum = new Map((ph ?? []).map(p => [p.phase_number, p]))
    setPhases(PHASES.map(n => byNum.get(n) ?? { phase_number: n, status: 'locked', planned_start: null, planned_end: null }))
    setMilestones(ms ?? [])

    // Team-aggregate progress: completed activities ÷ (content items × members)
    const { data: members } = await supabase.from('project_members').select('user_id').eq('project_id', project.id)
    const memberIds = (members ?? []).map(m => m.user_id)
    const { data: content } = await supabase.from('phase_content').select('phase_number')
    const cCount = {}
    ;(content ?? []).forEach(c => { cCount[c.phase_number] = (cCount[c.phase_number] || 0) + 1 })
    let acts = []
    if (memberIds.length) {
      const { data } = await supabase.from('user_activities').select('phase_number, status').in('user_id', memberIds).eq('status', 'completed')
      acts = data ?? []
    }
    const dCount = {}
    acts.forEach(a => { dCount[a.phase_number] = (dCount[a.phase_number] || 0) + 1 })
    const prog = {}
    PHASES.forEach(n => { prog[n] = { done: dCount[n] || 0, total: (cCount[n] || 0) * Math.max(memberIds.length, 1) } })
    setProgress(prog)
    setLoading(false)
  }

  function setPhaseDate(n, field, val) {
    setPhases(prev => prev.map(p => p.phase_number === n ? { ...p, [field]: val || null } : p))
  }

  async function saveDates() {
    setSavingDates(true)
    for (const p of phases) {
      if (p.id) {
        await supabase.from('project_phases').update({ planned_start: p.planned_start, planned_end: p.planned_end }).eq('id', p.id)
      } else if (p.planned_start || p.planned_end) {
        await supabase.from('project_phases').insert({ project_id: project.id, phase_number: p.phase_number, status: p.status ?? 'locked', planned_start: p.planned_start, planned_end: p.planned_end })
      }
    }
    setSavingDates(false)
    load()
  }

  async function saveMilestone() {
    if (!msForm.name.trim()) return
    const payload = {
      project_id: project.id,
      name: msForm.name.trim(),
      lane: msForm.lane,
      milestone_date: msForm.kind === 'point' ? (msForm.milestone_date || null) : null,
      starts_on: msForm.kind === 'band' ? (msForm.starts_on || null) : null,
      ends_on:   msForm.kind === 'band' ? (msForm.ends_on || null) : null,
    }
    setMsSaving(true)
    if (msForm.id) await supabase.from('project_milestones').update(payload).eq('id', msForm.id)
    else           await supabase.from('project_milestones').insert(payload)
    setMsSaving(false)
    setMsForm(null)
    load()
  }

  async function deleteMilestone(id) {
    if (!window.confirm('Delete this timeline item?')) return
    await supabase.from('project_milestones').delete().eq('id', id)
    load()
  }

  // ── Build time domain from every date present ──
  const allDates = []
  phases.forEach(p => { if (p.planned_start) allDates.push(toDate(p.planned_start)); if (p.planned_end) allDates.push(toDate(p.planned_end)) })
  milestones.forEach(m => { [m.milestone_date, m.starts_on, m.ends_on].forEach(d => d && allDates.push(toDate(d))) })
  const hasDomain = allDates.length > 0
  const domainStart = hasDomain ? monthFloor(new Date(Math.min(...allDates))) : null
  const domainEnd   = hasDomain ? monthCeil(new Date(Math.max(...allDates))) : null
  const span = hasDomain ? (domainEnd - domainStart) : 1
  const months = []
  if (hasDomain) { let d = new Date(domainStart); while (d < domainEnd) { months.push(new Date(d)); d = new Date(d.getFullYear(), d.getMonth() + 1, 1) } }
  const trackW = Math.max(months.length * MONTHW, 320)
  const posOf  = d => ((toDate(typeof d === 'string' ? d : iso(d)) - domainStart) / span) * trackW
  const today  = new Date()
  const todayIn = hasDomain && today >= domainStart && today <= domainEnd
  const todayX = todayIn ? posOf(today) : null
  const estTextW = t => (t?.length ?? 0) * 6.3 + 12  // rough px width for a 10px label

  const deliveryItems = milestones.filter(m => m.lane === 'delivery')
  const changeItems   = milestones.filter(m => m.lane === 'change')

  const LabelCol = ({ name, dates, accent }) => (
    <div className="w-[190px] shrink-0 pr-3">
      <p className={`text-xs font-semibold truncate ${accent ?? 'text-slate-800'}`}>{name}</p>
      {dates && <p className="text-[10px] text-slate-400">{dates}</p>}
    </div>
  )

  const TodayLine = () => todayX != null ? (
    <div className="absolute top-0 bottom-0 w-px bg-red-500 z-10" style={{ left: todayX }} />
  ) : null

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <p className="text-xs text-slate-500">
          Delivery milestones and the ChangeFlow phases for <strong>{project.name}</strong>, on a shared timeline.
        </p>
        {!readOnly && (
          <button onClick={() => setMsForm(emptyMs)}
            className="bg-[#E8913A] text-white text-xs font-semibold px-3 py-1.5 rounded-lg hover:bg-[#d07e2e] transition-colors shrink-0">
            + Timeline item
          </button>
        )}
      </div>

      {loading ? (
        <div className="h-40 bg-slate-100 rounded-2xl animate-pulse" />
      ) : !hasDomain ? (
        <div className="text-center py-12 bg-slate-50 rounded-2xl border border-slate-100 mb-6">
          <p className="text-slate-400 text-sm">No dates yet.</p>
          <p className="text-slate-300 text-xs mt-1">Set phase dates below (and add delivery milestones) to draw the timeline.</p>
        </div>
      ) : (
        <div className="border border-slate-200 rounded-2xl overflow-x-auto mb-6">
          <div style={{ minWidth: 190 + trackW + 16 }}>
            {/* Month axis */}
            <div className="flex border-b border-slate-100 bg-slate-50/60">
              <div className="w-[190px] shrink-0" />
              <div className="relative" style={{ width: trackW, height: 26 }}>
                {months.map((m, i) => (
                  <div key={i} className="absolute top-0 h-full border-l border-slate-100 text-[10px] text-slate-400 pl-1 pt-1"
                    style={{ left: i * MONTHW, width: MONTHW }}>
                    {m.toLocaleDateString(undefined, { month: 'short' })}{m.getMonth() === 0 ? ` ’${String(m.getFullYear()).slice(2)}` : ''}
                  </div>
                ))}
              </div>
            </div>

            {/* DELIVERY group */}
            <div className="px-3 pt-2 pb-1 text-[10px] font-bold tracking-widest text-slate-400">DELIVERY / PROJECT</div>
            {deliveryItems.length === 0 && (
              <div className="px-3 pb-2 text-[11px] text-slate-300">No delivery milestones yet.</div>
            )}
            {deliveryItems.map(m => {
              const isBand = m.starts_on && m.ends_on
              return (
                <div key={m.id} className="flex items-center border-b border-slate-50 group">
                  <LabelCol name={m.name} dates={isBand ? `${fmtShort(toDate(m.starts_on))} – ${fmtShort(toDate(m.ends_on))}` : (m.milestone_date ? fmtShort(toDate(m.milestone_date)) : '—')} accent="text-[#1F4E79]" />
                  <div className="relative flex-1 h-8" style={{ width: trackW }}>
                    <TodayLine />
                    {isBand ? (() => {
                      const bx = posOf(m.starts_on)
                      const bw = Math.max(posOf(m.ends_on) - bx, 8)
                      const inside = bw >= estTextW(m.name)
                      const outRight = bx + bw + estTextW(m.name) <= trackW
                      return (
                        <>
                          <div className="absolute top-1.5 h-5 rounded flex items-center px-1.5 overflow-hidden" style={{ left: bx, width: bw, background: '#e2e8f0', border: '1px solid #cbd5e1' }}>
                            {inside && <span className="text-[10px] font-semibold text-slate-600 whitespace-nowrap">{m.name}</span>}
                          </div>
                          {!inside && (
                            <span className="absolute top-2 text-[10px] font-semibold text-slate-600 whitespace-nowrap"
                              style={outRight ? { left: bx + bw + 4 } : { left: Math.max(bx - estTextW(m.name) - 4, 2) }}>{m.name}</span>
                          )}
                        </>
                      )
                    })() : m.milestone_date && (() => {
                      const dx = posOf(m.milestone_date)
                      const labelRight = dx + 12 + estTextW(m.name) <= trackW
                      return (
                        <>
                          <div className="absolute z-[5]" style={{ left: dx - 7, top: 6 }}>
                            <svg width="16" height="16" viewBox="0 0 16 16"><path d="M8 0 l8 8 -8 8 -8 -8 z" fill={m.color || '#1F4E79'} /></svg>
                          </div>
                          <span className="absolute top-2 text-[10px] font-semibold text-[#1F4E79] whitespace-nowrap"
                            style={labelRight ? { left: dx + 11 } : { left: Math.max(dx - estTextW(m.name) - 11, 2) }}>{m.name}</span>
                        </>
                      )
                    })()}
                  </div>
                  {!readOnly && (
                    <div className="w-16 shrink-0 pr-2 text-right opacity-0 group-hover:opacity-100 transition-opacity">
                      <button onClick={() => setMsForm({ ...emptyMs, ...m, kind: isBand ? 'band' : 'point', milestone_date: m.milestone_date ?? '', starts_on: m.starts_on ?? '', ends_on: m.ends_on ?? '' })} className="text-[10px] text-[#1F4E79] hover:underline">Edit</button>
                      <button onClick={() => deleteMilestone(m.id)} className="text-[10px] text-red-400 hover:underline ml-1.5">Del</button>
                    </div>
                  )}
                </div>
              )
            })}

            {/* CHANGEFLOW group */}
            <div className="px-3 pt-3 pb-1 text-[10px] font-bold tracking-widest text-[#E8913A]">CHANGEFLOW PHASES</div>
            {phases.map(p => {
              const cfg = STATUS[p.status] ?? STATUS.locked
              const pr = progress[p.phase_number] ?? { done: 0, total: 0 }
              const pct = pr.total > 0 ? Math.round((pr.done / pr.total) * 100) : 0
              const s = p.planned_start, e = p.planned_end
              const startX = s ? posOf(s) : null
              const endX   = e ? posOf(e) : (s ? posOf(s) + 30 : null)
              return (
                <div key={p.phase_number} className="flex items-center border-b border-slate-50">
                  <LabelCol name={`0${p.phase_number} ${PHASE_NAMES[p.phase_number]}`}
                    dates={s || e ? `${s ? fmtShort(toDate(s)) : '?'} – ${e ? fmtShort(toDate(e)) : '?'} · ${pct}% (${pr.done}/${pr.total})` : `not scheduled · ${pct}%`} />
                  <div className="relative flex-1 h-8" style={{ width: trackW }}>
                    <TodayLine />
                    {startX != null && (() => {
                      const barW = Math.max((endX ?? startX) - startX, 8)
                      const label = PHASE_NAMES[p.phase_number]
                      const inside = barW >= estTextW(label)
                      const outRight = startX + barW + estTextW(label) <= trackW
                      return (
                        <>
                          <div className="absolute top-1.5 h-5 rounded overflow-hidden" style={{ left: startX, width: barW, background: cfg.track }}>
                            {p.status !== 'locked' && <div className="h-full rounded" style={{ width: `${pct}%`, background: cfg.fill }} />}
                            {inside && <span className="absolute inset-0 flex items-center px-1.5 text-[10px] font-semibold whitespace-nowrap" style={{ color: cfg.text }}>{label}</span>}
                          </div>
                          {!inside && (
                            <span className="absolute top-2 text-[10px] font-semibold text-slate-600 whitespace-nowrap"
                              style={outRight ? { left: startX + barW + 4 } : { left: Math.max(startX - estTextW(label) - 4, 2) }}>{label}</span>
                          )}
                        </>
                      )
                    })()}
                  </div>
                  <div className="w-16 shrink-0" />
                </div>
              )
            })}
            <div className="h-2" />
          </div>
        </div>
      )}

      {/* Legend */}
      <div className="flex flex-wrap gap-4 text-[11px] text-slate-500 mb-6">
        <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm inline-block" style={{ background: '#16a34a' }} />Done</span>
        <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm inline-block" style={{ background: '#E8913A' }} />In progress</span>
        <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm inline-block border border-slate-300" style={{ background: '#e2e8f0' }} />Upcoming</span>
        <span className="flex items-center gap-1.5"><svg width="11" height="11" viewBox="0 0 16 16"><path d="M8 0 l8 8 -8 8 -8 -8 z" fill="#1F4E79" /></svg>Milestone</span>
        <span className="flex items-center gap-1.5"><span className="w-px h-3.5 bg-red-500 inline-block" />Today</span>
      </div>

      {/* Phase date editor */}
      {!readOnly && (
        <div className="bg-white border border-slate-100 rounded-2xl p-4 mb-4">
          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-3">Phase dates</p>
          <div className="space-y-2">
            {phases.map(p => (
              <div key={p.phase_number} className="flex items-center gap-3 flex-wrap">
                <span className="text-sm text-slate-700 w-28 shrink-0">0{p.phase_number} {PHASE_NAMES[p.phase_number]}</span>
                <input type="date" value={p.planned_start ?? ''} onChange={e => setPhaseDate(p.phase_number, 'planned_start', e.target.value)}
                  className="border border-slate-200 rounded-lg px-2 py-1 text-xs focus:outline-none focus:border-[#1F4E79]" />
                <span className="text-slate-300 text-xs">→</span>
                <input type="date" value={p.planned_end ?? ''} onChange={e => setPhaseDate(p.phase_number, 'planned_end', e.target.value)}
                  className="border border-slate-200 rounded-lg px-2 py-1 text-xs focus:outline-none focus:border-[#1F4E79]" />
              </div>
            ))}
          </div>
          <button onClick={saveDates} disabled={savingDates}
            className="mt-3 bg-[#1F4E79] text-white text-xs font-semibold px-4 py-2 rounded-lg hover:bg-[#163a5c] transition-colors disabled:opacity-60">
            {savingDates ? 'Saving…' : 'Save phase dates'}
          </button>
        </div>
      )}

      {/* Milestone form modal */}
      {msForm && (
        <>
          <div className="fixed inset-0 bg-black/40 z-40" onClick={() => setMsForm(null)} />
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 pointer-events-none">
            <div className="bg-white rounded-2xl shadow-2xl pointer-events-auto w-full max-w-md">
              <div className="px-6 py-5 border-b border-slate-100 flex items-center justify-between">
                <h3 className="font-bold text-slate-800">{msForm.id ? 'Edit timeline item' : 'New timeline item'}</h3>
                <button onClick={() => setMsForm(null)} className="w-7 h-7 rounded-full bg-slate-100 flex items-center justify-center text-slate-500 text-xs">✕</button>
              </div>
              <div className="px-6 py-5 space-y-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">Name *</label>
                  <input value={msForm.name} onChange={e => setMsForm({ ...msForm, name: e.target.value })} autoFocus
                    placeholder="e.g. Go-Live" className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#1F4E79]" />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-slate-600 mb-1">Lane</label>
                    <select value={msForm.lane} onChange={e => setMsForm({ ...msForm, lane: e.target.value })}
                      className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:border-[#1F4E79]">
                      <option value="delivery">Delivery / Project</option>
                      <option value="change">Change</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-600 mb-1">Type</label>
                    <select value={msForm.kind} onChange={e => setMsForm({ ...msForm, kind: e.target.value })}
                      className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:border-[#1F4E79]">
                      <option value="point">Milestone (a date)</option>
                      <option value="band">Band (start–end)</option>
                    </select>
                  </div>
                </div>
                {msForm.kind === 'point' ? (
                  <div>
                    <label className="block text-xs font-semibold text-slate-600 mb-1">Date</label>
                    <input type="date" value={msForm.milestone_date} onChange={e => setMsForm({ ...msForm, milestone_date: e.target.value })}
                      className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#1F4E79]" />
                  </div>
                ) : (
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-semibold text-slate-600 mb-1">Start</label>
                      <input type="date" value={msForm.starts_on} onChange={e => setMsForm({ ...msForm, starts_on: e.target.value })}
                        className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#1F4E79]" />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-600 mb-1">End</label>
                      <input type="date" value={msForm.ends_on} onChange={e => setMsForm({ ...msForm, ends_on: e.target.value })}
                        className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#1F4E79]" />
                    </div>
                  </div>
                )}
              </div>
              <div className="px-6 py-4 border-t border-slate-100 flex justify-end gap-3">
                <button onClick={() => setMsForm(null)} className="text-sm text-slate-500 px-4 py-2">Cancel</button>
                <button onClick={saveMilestone} disabled={msSaving}
                  className="bg-[#1F4E79] text-white text-sm font-semibold px-6 py-2 rounded-lg hover:bg-[#163a5c] transition-colors disabled:opacity-60">
                  {msSaving ? 'Saving…' : msForm.id ? 'Save' : 'Add'}
                </button>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
