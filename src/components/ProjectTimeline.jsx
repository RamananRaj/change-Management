import { Fragment, useState, useEffect, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { LANE_TINTS, laneStyle, buildLaneTree, rowsForLane } from '../lib/ai/analysis'

const PHASES = [1, 2, 3, 4, 5]
const PHASE_NAMES = { 1: 'Diagnose', 2: 'Design', 3: 'Engage', 4: 'Embed', 5: 'Evaluate' }
const STATUS = {
  completed: { fill: '#16a34a', track: '#16a34a', text: '#fff' },
  active:    { fill: '#E8913A', track: '#fde3c6', text: '#fff' },
  locked:    { fill: '#e2e8f0', track: '#e2e8f0', text: '#475569' },
}
const MONTHW = 90
const ROW_H  = 33          // row height + hairline border — one step of a vertical drag

const toDate = s => (s ? new Date(s + 'T00:00:00') : null)
const iso    = d => d.toISOString().slice(0, 10)
const monthFloor = d => new Date(d.getFullYear(), d.getMonth(), 1)
const monthCeil  = d => new Date(d.getFullYear(), d.getMonth() + 1, 1)
const fmtShort   = d => d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
// While dragging we show the full date — month and year matter when you're pushing a bar out.
const fmtLong    = d => d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })

const emptyMs = { name: '', lane_id: '', kind: 'point', milestone_date: '', starts_on: '', ends_on: '', color: '' }

// Bar colours. Empty = use the lane default, so existing items keep the look they have today.
const BAR_COLORS = [
  { hex: '',        label: 'Lane default' },
  { hex: '#1F4E79', label: 'ChangeFlow navy' },
  { hex: '#0d9488', label: 'Teal' },
  { hex: '#E8913A', label: 'Amber' },
  { hex: '#16a34a', label: 'Green' },
  { hex: '#dc2626', label: 'Red' },
  { hex: '#7c3aed', label: 'Violet' },
  { hex: '#0891b2', label: 'Cyan' },
  { hex: '#64748b', label: 'Slate' },
]
// A solid bar needs light text; the pale lane defaults need dark text.
const onColor = hex => (hex ? '#ffffff' : null)

export default function ProjectTimeline({ project, readOnly = false }) {
  const [phases,      setPhases]      = useState([])   // 5 rows (some may be unsaved)
  const [milestones,  setMilestones]  = useState([])
  const [progress,    setProgress]    = useState({})   // { phase: {done,total} }
  const [loading,     setLoading]     = useState(true)
  const [savingDates, setSavingDates] = useState(false)
  const [msForm,      setMsForm]      = useState(null)  // milestone being added/edited
  const [msSaving,    setMsSaving]    = useState(false)
  const [lanes,       setLanes]       = useState([])   // project_lanes, flat; parent_id makes a sub-lane
  const [activities,  setActivities]  = useState([])   // dated project_pathways rows
  const [laneForm,    setLaneForm]    = useState(null) // lane being added/edited

  useEffect(() => { if (project?.id) load() /* eslint-disable-next-line */ }, [project?.id])

  async function load() {
    setLoading(true)
    const [{ data: ph }, { data: ms }, { data: ln }, { data: dated }] = await Promise.all([
      supabase.from('project_phases').select('*').eq('project_id', project.id).order('phase_number'),
      supabase.from('project_milestones').select('*').eq('project_id', project.id)
        .order('sort_order', { ascending: true }).order('milestone_date', { ascending: true }),
      supabase.from('project_lanes').select('*').eq('project_id', project.id)
        .order('sort_order', { ascending: true }),
      supabase.from('project_pathways')
        .select('id, phase_number, pathway_step, starts_on, ends_on, lane_id, color, sort_order, phase_content(title)')
        .eq('project_id', project.id)
        .order('sort_order', { ascending: true }).order('pathway_step', { ascending: true }),
    ])
    const byNum = new Map((ph ?? []).map(p => [p.phase_number, p]))
    setPhases(PHASES.map(n => byNum.get(n) ?? { phase_number: n, status: 'locked', planned_start: null, planned_end: null }))
    setLanes(ln ?? [])
    // Legacy rows predate lane_id and carry a 'delivery'/'change' text lane instead.
    // Resolve them to a lane row by name so the two never diverge on screen.
    const laneByName = new Map((ln ?? []).filter(l => !l.parent_id).map(l => [l.name.toLowerCase(), l.id]))
    setMilestones((ms ?? []).map(m => ({ ...m, lane_id: m.lane_id ?? laneByName.get((m.lane ?? '').toLowerCase()) ?? null })))
    setActivities((dated ?? []).map(a => ({ ...a, name: a.phase_content?.title ?? 'Untitled activity' })))

    // Team-aggregate progress, scoped to THIS project's pathway items only
    // (not the whole content library): completed pathway activities ÷ (pathway items × members).
    const { data: members } = await supabase.from('project_members').select('user_id').eq('project_id', project.id)
    const memberIds = (members ?? []).map(m => m.user_id)
    const { data: pathway } = await supabase.from('project_pathways')
      .select('phase_number, content_id').eq('project_id', project.id)
    const cCount = {}                        // pathway items per phase
    const pathIds = new Set()                // content_ids that are in the pathway
    ;(pathway ?? []).forEach(p => {
      cCount[p.phase_number] = (cCount[p.phase_number] || 0) + 1
      pathIds.add(p.content_id)
    })
    let acts = []
    if (memberIds.length && pathIds.size) {
      const { data } = await supabase.from('user_activities')
        .select('phase_number, content_id, status')
        .in('user_id', memberIds).eq('status', 'completed')
      acts = (data ?? []).filter(a => pathIds.has(a.content_id))  // only pathway items count
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
    setMsSaving(true)
    // An activity row belongs to the pathway; the timeline only schedules and colours it.
    if (msForm.activityId) {
      await supabase.from('project_pathways').update({
        starts_on: msForm.starts_on || null,
        ends_on:   msForm.ends_on || null,
        lane_id:   msForm.lane_id || null,
        color:     msForm.color || null,
      }).eq('id', msForm.activityId)
      setMsSaving(false); setMsForm(null); load()
      return
    }
    if (!msForm.name.trim()) { setMsSaving(false); return }
    const laneRow = lanes.find(l => l.id === msForm.lane_id)
    const payload = {
      project_id: project.id,
      name: msForm.name.trim(),
      lane_id: msForm.lane_id || null,
      // The legacy text column has a CHECK constraint on ('delivery','change'), so a
      // custom lane can't be written there. Keep it valid; lane_id is what's read.
      lane: ['delivery', 'change'].includes((laneRow?.name ?? '').toLowerCase()) ? laneRow.name.toLowerCase() : 'delivery',
      milestone_date: msForm.kind === 'point' ? (msForm.milestone_date || null) : null,
      starts_on: msForm.kind === 'band' ? (msForm.starts_on || null) : null,
      ends_on:   msForm.kind === 'band' ? (msForm.ends_on || null) : null,
      color:     msForm.color || null,
    }
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

  async function saveLane() {
    if (!laneForm.name.trim()) return
    const payload = {
      project_id: project.id,
      parent_id: laneForm.parent_id ?? null,
      name: laneForm.name.trim(),
      tint: laneForm.tint || '#f8fafc',
      sort_order: laneForm.sort_order ?? lanes.length,
    }
    if (laneForm.id) await supabase.from('project_lanes').update(payload).eq('id', laneForm.id)
    else             await supabase.from('project_lanes').insert(payload)
    setLaneForm(null)
    load()
  }

  async function deleteLane(lane) {
    const kids = lanes.filter(l => l.parent_id === lane.id).length
    const rows = rowsForLane(lane.id, milestones, activities).length
    const warn = kids || rows
      ? `Delete “${lane.name}”? Its ${kids ? `${kids} sub-lane(s) and ` : ''}${rows} item(s) stay in the project but lose their lane.`
      : `Delete “${lane.name}”?`
    if (!window.confirm(warn)) return
    // ON DELETE SET NULL on both FKs means bars survive; they just fall out of a lane.
    await supabase.from('project_lanes').delete().eq('id', lane.id)
    load()
  }

  // ── Drag to reschedule ──────────────────────────────────────────────────────
  // Drag a bar's middle to move it, or either edge to change its duration. Dates preview live
  // while dragging (day-snapped) and only persist on release, so a cancelled drag changes nothing.
  const dragRef = useRef(null)
  const [dragTick, setDragTick] = useState(0)
  const bump = () => setDragTick(t => t + 1)
  const shiftIso = (isoStr, days) => { const d = toDate(isoStr); d.setDate(d.getDate() + days); return iso(d) }

  function dragPreview(d) {
    if (!d) return null
    const days = Math.round(((d.dx * (domainEnd - domainStart)) / trackW) / 864e5)
    if (d.mode === 'move') return { s: shiftIso(d.s, days), e: d.e ? shiftIso(d.e, days) : null }
    if (d.mode === 'start') { const ns = shiftIso(d.s, days); return { s: d.e && ns > d.e ? d.e : ns, e: d.e } }
    if (d.mode === 'end') { const ne = shiftIso(d.e, days); return { s: d.s, e: ne < d.s ? d.s : ne } }
    return { s: d.s, e: d.e }
  }
  // Dates to draw for this row — the live preview while dragging, otherwise what's stored.
  const live = (id, s, e) => {
    const d = dragRef.current
    if (!d || d.id !== id) return { s, e }
    return dragPreview(d) ?? { s, e }
  }

  function beginDrag(ev, item, mode, table) {
    if (readOnly || !hasDomain) return
    ev.preventDefault(); ev.stopPropagation()
    dragRef.current = {
      id: item.id ?? item.phase_number, mode, table,
      s: item.starts_on ?? item.planned_start ?? item.milestone_date,
      e: item.ends_on ?? item.planned_end ?? null,
      x0: ev.clientX, dx: 0, y0: ev.clientY, dy: 0,
      laneId: item.lane_id ?? null, name: item.name ?? PHASE_NAMES[item.phase_number],
    }
    bump()
    const move = e2 => {
      if (!dragRef.current) return
      dragRef.current.dx = e2.clientX - dragRef.current.x0
      dragRef.current.dy = e2.clientY - dragRef.current.y0
      bump()
    }
    const up = async () => {
      window.removeEventListener('pointermove', move)
      const d = dragRef.current
      dragRef.current = null; bump()
      if (!d) return

      // Vertical drag reorders the row within its lane. Phases keep their fixed 1–5 sequence.
      const steps = Math.round(d.dy / ROW_H)
      if (steps && d.laneId && d.mode === 'move') {
        const lane = rowsForLane(d.laneId, milestones, activities)
        const from = lane.findIndex(x => x.id === d.id)
        const to = Math.max(0, Math.min(lane.length - 1, from + steps))
        if (from !== -1 && from !== to) {
          const [moved] = lane.splice(from, 1)
          lane.splice(to, 0, moved)
          // Rows in a lane can come from either table, so each update is routed by its own.
          await Promise.all(lane.map((x, i) =>
            supabase.from(x.table).update({ sort_order: i }).eq('id', x.id)))
        }
      }

      if (!d.dx) { if (steps) load(); return }
      const p = dragPreview({ ...d })
      if (!p) return
      if (d.table === 'project_phases') {
        await supabase.from('project_phases').update({ planned_start: p.s, planned_end: p.e })
          .eq('project_id', project.id).eq('phase_number', d.id)
      } else if (d.table === 'project_pathways') {
        await supabase.from('project_pathways').update({ starts_on: p.s, ends_on: p.e }).eq('id', d.id)
      } else if (p.e) {
        await supabase.from('project_milestones').update({ starts_on: p.s, ends_on: p.e }).eq('id', d.id)
      } else {
        await supabase.from('project_milestones').update({ milestone_date: p.s }).eq('id', d.id)
      }
      load()
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up, { once: true })
  }

  // While dragging, the bar itself follows the cursor vertically so the gesture reads as direct
  // manipulation rather than the row blanking and snapping somewhere else on release.
  const dragLift = id => {
    const d = dragRef.current
    if (!d || d.id !== id) return null
    return { transform: `translateY(${d.dy}px)`, zIndex: 30, opacity: 0.92, transition: 'none' }
  }

  // Grab handles on a band: middle moves, edges resize.
  const handleStyle = 'absolute top-0 h-full w-2 cursor-ew-resize'
  const DragTip = ({ id }) => {
    void dragTick            // re-render on every pointer move while dragging
    const d = dragRef.current
    if (!d || d.id !== id) return null
    const p = dragPreview(d)
    if (!p) return null
    const txt = p.e ? `${fmtLong(toDate(p.s))} → ${fmtLong(toDate(p.e))}` : fmtLong(toDate(p.s))
    const steps = Math.round(d.dy / ROW_H)
    const rowMove = (steps && d.table === 'project_milestones' && d.mode === 'move')
      ? ` · ${steps > 0 ? '↓' : '↑'} ${Math.abs(steps)} row${Math.abs(steps) === 1 ? '' : 's'}` : ''
    return (
      <div className="absolute -top-5 z-20 bg-[#1F4E79] text-white text-[10px] font-semibold px-2 py-0.5 rounded whitespace-nowrap pointer-events-none"
        style={{ left: Math.max(posOf(p.s), 0) }}>{txt}{rowMove}</div>
    )
  }

  // ── Build time domain from every date present ──
  const allDates = []
  phases.forEach(p => { if (p.planned_start) allDates.push(toDate(p.planned_start)); if (p.planned_end) allDates.push(toDate(p.planned_end)) })
  milestones.forEach(m => { [m.milestone_date, m.starts_on, m.ends_on].forEach(d => d && allDates.push(toDate(d))) })
  activities.forEach(a => { [a.starts_on, a.ends_on].forEach(d => d && allDates.push(toDate(d))) })
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

  const laneTree = buildLaneTree(lanes)
  const rowsIn = laneId => rowsForLane(laneId, milestones, activities)

  // A single row renderer for every lane. Milestones and activities differ only in
  // which table an edit writes back to, so one component covers both and the two
  // lanes stop drifting apart the way the old copy-pasted blocks did.
  const TimelineRow = ({ r, accent, dim, depth = 0 }) => {
    const isBand = r.starts_on && r.ends_on
    const dates = isBand ? `${fmtShort(toDate(r.starts_on))} – ${fmtShort(toDate(r.ends_on))}`
      : (r.milestone_date ? fmtShort(toDate(r.milestone_date)) : 'No dates set')
    return (
      <div className="flex items-center border-b border-slate-50 group">
        {/* Nesting indents the LABEL only. Indenting the row would shift the track
            and every bar in a sub-lane would sit at the wrong date. */}
        <div className="w-[190px] shrink-0 pr-3" style={{ paddingLeft: 12 + depth * 14 }}>
          <p className={`text-xs font-semibold truncate ${r.undated ? 'text-slate-400' : ''}`} style={r.undated ? {} : { color: accent }}>{r.name}</p>
          <p className={`text-[10px] ${r.undated ? 'text-amber-500' : 'text-slate-400'}`}>{dates}</p>
        </div>
        <div className="relative flex-1 h-8" style={{ width: trackW }}>
          <MonthGrid />
          <TodayLine />
          {isBand ? (() => {
            const lv = live(r.id, r.starts_on, r.ends_on)
            const bx = posOf(lv.s)
            const bw = Math.max(posOf(lv.e) - bx, 8)
            const inside = bw >= estTextW(r.name)
            const outRight = bx + bw + estTextW(r.name) <= trackW
            return (
              <>
                <DragTip id={r.id} />
                <div onPointerDown={e => beginDrag(e, r, 'move', r.table)}
                  title={readOnly ? '' : 'Drag to move · drag an edge to change duration'}
                  className={`absolute top-1.5 h-5 rounded flex items-center px-1.5 overflow-hidden ${readOnly ? '' : 'cursor-grab active:cursor-grabbing'}`}
                  style={{ left: bx, width: bw, background: r.color || dim, border: `1px solid ${r.color || dim}`, ...(dragLift(r.id) || {}) }}>
                  {inside && <span className="text-[10px] font-semibold whitespace-nowrap select-none" style={{ color: onColor(r.color) || accent }}>{r.name}</span>}
                </div>
                {!readOnly && (
                  <>
                    <div className={handleStyle} style={{ left: bx - 3 }} onPointerDown={e => beginDrag(e, r, 'start', r.table)} />
                    <div className={handleStyle} style={{ left: bx + bw - 5 }} onPointerDown={e => beginDrag(e, r, 'end', r.table)} />
                  </>
                )}
                {!inside && (
                  <span className="absolute top-2 text-[10px] font-semibold whitespace-nowrap" style={{ color: accent, ...(outRight ? { left: bx + bw + 4 } : { left: Math.max(bx - estTextW(r.name) - 4, 2) }) }}>{r.name}</span>
                )}
              </>
            )
          })() : r.milestone_date ? (() => {
            const dx = posOf(live(r.id, r.milestone_date, null).s)
            const labelRight = dx + 12 + estTextW(r.name) <= trackW
            return (
              <>
                <DragTip id={r.id} />
                <div className={`absolute z-[5] ${readOnly ? '' : 'cursor-grab active:cursor-grabbing'}`} style={{ left: dx - 7, top: 6, ...(dragLift(r.id) || {}) }}
                  title={readOnly ? '' : 'Drag to move this milestone'}
                  onPointerDown={e => beginDrag(e, r, 'move', r.table)}>
                  <svg width="16" height="16" viewBox="0 0 16 16"><path d="M8 0 l8 8 -8 8 -8 -8 z" fill={r.color || accent} /></svg>
                </div>
                <span className="absolute top-2 text-[10px] font-semibold whitespace-nowrap" style={{ color: accent, ...(labelRight ? { left: dx + 11 } : { left: Math.max(dx - estTextW(r.name) - 11, 2) }) }}>{r.name}</span>
              </>
            )
          })() : (
            // No dates: draw nothing on the track rather than guessing a position.
            // The amber "No dates set" in the label column is the whole signal.
            <span className="absolute top-2 left-2 text-[10px] text-slate-300 italic">not scheduled</span>
          )}
        </div>
        {!readOnly && (
          <div className="w-16 shrink-0 pr-2 text-right opacity-0 group-hover:opacity-100 transition-opacity">
            <button onClick={() => openRowEditor(r)} className="text-[10px] hover:underline" style={{ color: accent }}>Edit</button>
            {r.table === 'project_milestones' && (
              <button onClick={() => deleteMilestone(r.id)} className="text-[10px] text-red-400 hover:underline ml-1.5">Del</button>
            )}
          </div>
        )}
      </div>
    )
  }

  // Activities are owned by the pathway, so the timeline edits their dates and colour
  // but never their name or existence — that stays in the pathway builder.
  function openRowEditor(r) {
    if (r.table === 'project_pathways') {
      setMsForm({ ...emptyMs, activityId: r.id, name: r.name, kind: 'band', lane_id: r.lane_id,
        starts_on: r.starts_on ?? '', ends_on: r.ends_on ?? '', color: r.color ?? '' })
      return
    }
    const m = milestones.find(x => x.id === r.id) ?? r
    setMsForm({ ...emptyMs, ...m, kind: (m.starts_on && m.ends_on) ? 'band' : 'point',
      milestone_date: m.milestone_date ?? '', starts_on: m.starts_on ?? '', ends_on: m.ends_on ?? '', color: m.color ?? '' })
  }

  // Lane bands span the full width with no side borders or horizontal padding, so
  // every row in the chart shares one track origin. Depth is expressed by indenting
  // the label column and by the header, never by insetting the band itself.
  const LaneBand = ({ lane, depth = 0 }) => {
    const st = laneStyle(lane.tint)
    const rows = rowsIn(lane.id)
    const nested = depth > 0
    return (
      <div style={{ background: nested ? '#ffffff' : st.tint, borderTop: `1px solid ${st.border}`, borderBottom: `1px solid ${st.border}` }}>
        <div className="flex items-center justify-between pr-3 pt-2 pb-1 group/lane" style={{ paddingLeft: 12 + depth * 14 }}>
          <span className={`font-semibold ${nested ? 'text-[10px]' : 'text-[11px]'}`} style={{ color: st.text }}>
            {nested && <span className="opacity-50 mr-1">↳</span>}{lane.name}
          </span>
          {!readOnly && (
            <span className="flex gap-2 opacity-60 group-hover/lane:opacity-100 transition-opacity">
              <button onClick={() => setLaneForm({ ...lane })} className="text-[10px] hover:underline" style={{ color: st.text }}>Edit lane</button>
              {!nested && <button onClick={() => setLaneForm({ project_id: project.id, parent_id: lane.id, name: '', tint: '#f8fafc', sort_order: (lane.children?.length ?? 0) })} className="text-[10px] hover:underline" style={{ color: st.text }}>+ Sub-lane</button>}
              <button onClick={() => deleteLane(lane)} className="text-[10px] text-red-400 hover:underline">Delete</button>
            </span>
          )}
        </div>
        {rows.length === 0 && (lane.children?.length ?? 0) === 0 && (
          <div className="pb-2 text-[11px] text-slate-400" style={{ paddingLeft: 12 + depth * 14 }}>Nothing in this lane yet.</div>
        )}
        {rows.map(r => <TimelineRow key={`${r.table}-${r.id}`} r={r} accent={st.text} dim={st.border} depth={depth} />)}
        {(lane.children ?? []).map(c => <LaneBand key={c.id} lane={c} depth={depth + 1} />)}
      </div>
    )
  }

  // Same 12px left inset as TimelineRow, so phase labels and lane labels line up.
  const LabelCol = ({ name, dates, accent }) => (
    <div className="w-[190px] shrink-0 pr-3 pl-3">
      <p className={`text-xs font-semibold truncate ${accent ?? 'text-slate-800'}`}>{name}</p>
      {dates && <p className="text-[10px] text-slate-400">{dates}</p>}
    </div>
  )

  const TodayLine = () => todayX != null ? (
    <div className="absolute top-0 bottom-0 w-px bg-red-500 z-10" style={{ left: todayX }} />
  ) : null

  // Month boundaries drawn behind every row: a hairline at each start plus a very
  // faint wash on alternate months, so you can read across to a date without
  // tracing back up to the axis. Pointer-events off — bars stay draggable.
  const MonthGrid = () => (
    <div className="absolute inset-0 pointer-events-none">
      {months.map((m, i) => (
        <div key={i} className="absolute top-0 bottom-0"
          style={{
            left: i * MONTHW, width: MONTHW,
            borderLeft: '1px solid rgba(148,163,184,0.16)',
            background: i % 2 ? 'rgba(148,163,184,0.05)' : 'transparent',
          }} />
      ))}
    </div>
  )

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <p className="text-xs text-slate-500">
          Delivery milestones and the ChangeFlow phases for <strong>{project.name}</strong>, on a shared timeline.
        </p>
        {!readOnly && (
          <div className="flex gap-2 shrink-0">
            <button onClick={() => setLaneForm({ project_id: project.id, parent_id: null, name: '', tint: LANE_TINTS[0].tint, sort_order: lanes.filter(l => !l.parent_id).length })}
              className="border border-slate-200 text-slate-600 text-xs font-semibold px-3 py-1.5 rounded-lg hover:bg-slate-50 transition-colors">
              + Swimlane
            </button>
            <button onClick={() => setMsForm({ ...emptyMs, lane_id: laneTree[0]?.id ?? '' })}
              className="bg-[#E8913A] text-white text-xs font-semibold px-3 py-1.5 rounded-lg hover:bg-[#d07e2e] transition-colors">
              + Timeline item
            </button>
          </div>
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
            <div className="flex border-b border-slate-200 bg-white sticky top-0 z-20">
              <div className="w-[190px] shrink-0" />
              <div className="relative" style={{ width: trackW, height: 30 }}>
                {months.map((m, i) => {
                  const jan = m.getMonth() === 0
                  return (
                    <div key={i} className="absolute top-0 h-full flex items-center"
                      style={{
                        left: i * MONTHW, width: MONTHW,
                        // January gets a stronger rule — a year boundary is worth more ink.
                        borderLeft: `1px solid ${jan ? 'rgba(100,116,139,0.35)' : 'rgba(148,163,184,0.22)'}`,
                        background: i % 2 ? 'rgba(148,163,184,0.05)' : 'transparent',
                      }}>
                      <span className={`text-[10px] pl-2 tracking-wide ${jan ? 'text-slate-600 font-semibold' : 'text-slate-400'}`}>
                        {m.toLocaleDateString(undefined, { month: 'short' })}{jan ? ` ’${String(m.getFullYear()).slice(2)}` : ''}
                      </span>
                    </div>
                  )
                })}
              </div>
            </div>

            {/* Swimlanes. No wrapper padding — the track must start at the same x as
                the phase rows below, or the two halves of the chart disagree on dates. */}
            {laneTree.length === 0 && (
              <div className="px-3 py-4 text-[11px] text-slate-400">No swimlanes yet. Add one to group your bars.</div>
            )}
            {laneTree.map(l => <LaneBand key={l.id} lane={l} />)}
            {/* CHANGEFLOW group */}
            <div className="pt-3 pb-1 text-[10px] font-bold tracking-widest text-[#E8913A]" style={{ paddingLeft: 12 }}>CHANGEFLOW PHASES</div>
            {phases.map(p => {
              const pr = progress[p.phase_number] ?? { done: 0, total: 0 }
              const pct = pr.total > 0 ? Math.round((pr.done / pr.total) * 100) : 0
              const s = p.planned_start, e = p.planned_end
              // Colour is driven by the schedule (today vs the phase dates), not just the
              // manual status: a phase whose dates contain today shows as In progress.
              const today = new Date()
              const startD = s ? toDate(s) : null
              const endD   = e ? toDate(e) : null
              let effStatus = p.status ?? 'locked'
              if (pct >= 100 || p.status === 'completed' || p.status === 'done') {
                effStatus = 'completed'
              } else if (startD && endD) {
                if (today >= startD && today <= endD)      effStatus = 'active'   // in progress
                else if (today > endD)                     effStatus = 'active'   // overdue, still underway
                else                                       effStatus = 'locked'   // upcoming
              }
              const cfg = STATUS[effStatus] ?? STATUS.locked
              const plv = live(p.phase_number, s, e)
              const startX = plv.s ? posOf(plv.s) : null
              const endX   = plv.e ? posOf(plv.e) : (plv.s ? posOf(plv.s) + 30 : null)
              return (
                <div key={p.phase_number} className="flex items-center border-b border-slate-50">
                  <LabelCol name={`0${p.phase_number} ${PHASE_NAMES[p.phase_number]}`}
                    dates={s || e ? `${s ? fmtShort(toDate(s)) : '?'} – ${e ? fmtShort(toDate(e)) : '?'} · ${pct}% (${pr.done}/${pr.total})` : `not scheduled · ${pct}%`} />
                  <div className="relative flex-1 h-8" style={{ width: trackW }}>
                    <MonthGrid />
                    <TodayLine />
                    {startX != null && (() => {
                      const barW = Math.max((endX ?? startX) - startX, 8)
                      const label = PHASE_NAMES[p.phase_number]
                      const inside = barW >= estTextW(label)
                      const outRight = startX + barW + estTextW(label) <= trackW
                      return (
                        <>
                          <DragTip id={p.phase_number} />
                          {!readOnly && plv.s && plv.e && (
                            <>
                              <div className={handleStyle} style={{ left: startX - 3 }} onPointerDown={ev => beginDrag(ev, p, 'start', 'project_phases')} />
                              <div className={handleStyle} style={{ left: startX + barW - 5 }} onPointerDown={ev => beginDrag(ev, p, 'end', 'project_phases')} />
                            </>
                          )}
                          <div onPointerDown={ev => plv.s && beginDrag(ev, p, 'move', 'project_phases')}
                            title={readOnly ? '' : 'Drag to move · drag an edge to change duration'}
                            className={`absolute top-1.5 h-5 rounded overflow-hidden ${readOnly ? '' : 'cursor-grab active:cursor-grabbing'}`}
                            style={{ left: startX, width: barW, background: cfg.track, ...(dragLift(p.phase_number) || {}) }}>
                            {effStatus !== 'locked' && <div className="h-full rounded" style={{ width: `${pct}%`, background: cfg.fill }} />}
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
                <h3 className="font-bold text-slate-800">{msForm.activityId ? 'Schedule activity' : msForm.id ? 'Edit timeline item' : 'New timeline item'}</h3>
                <button onClick={() => setMsForm(null)} className="w-7 h-7 rounded-full bg-slate-100 flex items-center justify-center text-slate-500 text-xs">✕</button>
              </div>
              <div className="px-6 py-5 space-y-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">Name {msForm.activityId ? '' : '*'}</label>
                  <input value={msForm.name} onChange={e => setMsForm({ ...msForm, name: e.target.value })} autoFocus={!msForm.activityId}
                    disabled={!!msForm.activityId}
                    placeholder="e.g. Go-Live" className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#1F4E79] disabled:bg-slate-50 disabled:text-slate-500" />
                  {msForm.activityId && <p className="text-[10px] text-slate-400 mt-1">Activity names come from the pathway. Rename it there.</p>}
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-slate-600 mb-1">Lane</label>
                    <select value={msForm.lane_id ?? ''} onChange={e => setMsForm({ ...msForm, lane_id: e.target.value })}
                      className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:border-[#1F4E79]">
                      <option value="">— no lane —</option>
                      {buildLaneTree(lanes).map(l => (
                        <Fragment key={l.id}>
                          <option value={l.id}>{l.name}</option>
                          {(l.children ?? []).map(c => <option key={c.id} value={c.id}>&nbsp;&nbsp;↳ {c.name}</option>)}
                        </Fragment>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-600 mb-1">Type</label>
                    <select value={msForm.kind} onChange={e => setMsForm({ ...msForm, kind: e.target.value })}
                      disabled={!!msForm.activityId}
                      className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:border-[#1F4E79] disabled:bg-slate-50 disabled:text-slate-500">
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

                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">Colour</label>
                  <div className="flex items-center gap-2 flex-wrap">
                    {BAR_COLORS.map(c => {
                      const on = (msForm.color || '') === c.hex
                      return (
                        <button key={c.label} type="button" title={c.label}
                          onClick={() => setMsForm({ ...msForm, color: c.hex })}
                          className={`w-7 h-7 rounded-lg border-2 transition-colors ${on ? 'border-[#1F4E79]' : 'border-slate-200 hover:border-slate-300'}`}
                          style={c.hex
                            ? { background: c.hex }
                            : { background: 'repeating-linear-gradient(45deg,#f1f5f9,#f1f5f9 4px,#e2e8f0 4px,#e2e8f0 8px)' }}>
                          {on && <span className="text-[11px] font-bold" style={{ color: c.hex ? '#fff' : '#1F4E79' }}>✓</span>}
                        </button>
                      )
                    })}
                    <label className="flex items-center gap-1.5 text-[11px] text-slate-500 ml-1">
                      <input type="color" value={msForm.color || '#1F4E79'}
                        onChange={e => setMsForm({ ...msForm, color: e.target.value })}
                        className="w-7 h-7 p-0 border border-slate-200 rounded-lg cursor-pointer bg-white" />
                      Custom
                    </label>
                  </div>
                  <p className="text-[10px] text-slate-400 mt-1">“Lane default” keeps the standard Delivery / Change styling.</p>
                </div>
              </div>
              <div className="px-6 py-4 border-t border-slate-100 flex justify-end gap-3">
                <button onClick={() => setMsForm(null)} className="text-sm text-slate-500 px-4 py-2">Cancel</button>
                <button onClick={saveMilestone} disabled={msSaving}
                  className="bg-[#1F4E79] text-white text-sm font-semibold px-6 py-2 rounded-lg hover:bg-[#163a5c] transition-colors disabled:opacity-60">
                  {msSaving ? 'Saving…' : msForm.id || msForm.activityId ? 'Save' : 'Add'}
                </button>
              </div>
            </div>
          </div>
        </>
      )}

      {laneForm && (
        <>
          <div className="fixed inset-0 bg-black/40 z-40" onClick={() => setLaneForm(null)} />
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 pointer-events-none">
            <div className="bg-white rounded-2xl shadow-2xl pointer-events-auto w-full max-w-md">
              <div className="px-6 py-5 border-b border-slate-100 flex items-center justify-between">
                <h3 className="font-bold text-slate-800">
                  {laneForm.id ? 'Edit swimlane' : laneForm.parent_id ? 'New sub-swimlane' : 'New swimlane'}
                </h3>
                <button onClick={() => setLaneForm(null)} className="w-7 h-7 rounded-full bg-slate-100 flex items-center justify-center text-slate-500 text-xs">✕</button>
              </div>
              <div className="px-6 py-5 space-y-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">Name *</label>
                  <input value={laneForm.name} onChange={e => setLaneForm({ ...laneForm, name: e.target.value })} autoFocus
                    placeholder={laneForm.parent_id ? 'e.g. Training' : 'e.g. Delivery'}
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#1F4E79]" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">Lane tint</label>
                  <div className="flex items-center gap-2 flex-wrap">
                    {LANE_TINTS.map(t => {
                      const on = laneForm.tint === t.tint
                      return (
                        <button key={t.tint} type="button" title={t.label}
                          onClick={() => setLaneForm({ ...laneForm, tint: t.tint })}
                          className="w-9 h-8 rounded-lg flex items-center justify-center transition-colors"
                          style={{ background: t.tint, border: `2px solid ${on ? t.text : t.border}` }}>
                          {on && <span className="text-[11px] font-bold" style={{ color: t.text }}>✓</span>}
                        </button>
                      )
                    })}
                  </div>
                  <p className="text-[10px] text-slate-400 mt-1">
                    Tints stay pale on purpose — a saturated lane would swallow the bars drawn on it.
                  </p>
                </div>
                {!laneForm.id && !laneForm.parent_id && (
                  <p className="text-[11px] text-slate-500 bg-slate-50 rounded-lg px-3 py-2">
                    Add sub-swimlanes from the lane header once this one exists.
                  </p>
                )}
              </div>
              <div className="px-6 py-4 border-t border-slate-100 flex justify-end gap-3">
                <button onClick={() => setLaneForm(null)} className="text-sm text-slate-500 px-4 py-2">Cancel</button>
                <button onClick={saveLane} disabled={!laneForm.name.trim()}
                  className="bg-[#1F4E79] text-white text-sm font-semibold px-6 py-2 rounded-lg hover:bg-[#163a5c] transition-colors disabled:opacity-60">
                  {laneForm.id ? 'Save' : 'Add'}
                </button>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
