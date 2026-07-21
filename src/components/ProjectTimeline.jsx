import { Fragment, useState, useEffect, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { LANE_TINTS, laneStyle, buildLaneTree, rowsForLane, groupLaneRows, laneProgress } from '../lib/ai/analysis'

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
// dd/mm for the compact labels sitting at the end of each bar.
const ddmm = s => { const d = toDate(s); return d ? `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}` : '' }

const emptyMs = { name: '', lane_id: '', kind: 'point', milestone_date: '', starts_on: '', ends_on: '', color: '', pct: 0 }

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
// The unfilled part of a bar: the same hue at low opacity, so a bar at 40% reads as
// one bar partly done rather than two bars of different colours butted together.
const tintOf = hex => {
  if (!hex?.startsWith('#') || hex.length !== 7) return hex
  const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16))
  return `rgba(${r},${g},${b},0.22)`
}

export default function ProjectTimeline({ project, readOnly = false }) {
  const [phases,      setPhases]      = useState([])   // 5 rows (some may be unsaved)
  const [milestones,  setMilestones]  = useState([])
  const [progress,    setProgress]    = useState({})   // { phase: {done,total} }
  // The shape laneProgress() expects: one entry per exercise, carrying how many assigned
  // members have completed it. Kept beside `progress` rather than replacing it — the bars
  // want a single percentage, the lane roll-up wants the exercises it was made from.
  const [phaseEx,     setPhaseEx]     = useState({})   // { phase: [{ id, completedBy }] }
  const [teamSize,    setTeamSize]    = useState(1)
  const [loading,     setLoading]     = useState(true)
  const [msForm,      setMsForm]      = useState(null)  // milestone being added/edited
  const [msSaving,    setMsSaving]    = useState(false)
  const [lanes,       setLanes]       = useState([])   // project_lanes, flat; parent_id makes a sub-lane
  const [activities,  setActivities]  = useState([])   // dated project_pathways rows
  const [laneForm,    setLaneForm]    = useState(null) // lane being added/edited

  useEffect(() => { if (project?.id) load() /* eslint-disable-next-line */ }, [project?.id])

  // quiet = refresh in place. Only the first load shows the skeleton; a refresh after
  // an edit must not blank the chart, or every drag flashes the whole view away.
  async function load({ quiet = false } = {}) {
    if (!quiet) setLoading(true)
    const [{ data: ph }, { data: ms }, { data: ln }, { data: dated }] = await Promise.all([
      supabase.from('project_phases').select('*').eq('project_id', project.id).order('phase_number'),
      supabase.from('project_milestones').select('*').eq('project_id', project.id)
        .order('sort_order', { ascending: true }).order('milestone_date', { ascending: true }),
      supabase.from('project_lanes').select('*').eq('project_id', project.id)
        .order('sort_order', { ascending: true }),
      supabase.from('project_pathways')
        .select('id, phase_number, pathway_step, content_id, starts_on, ends_on, lane_id, color, sort_order, phase_content(title)')
        .eq('project_id', project.id)
        .order('sort_order', { ascending: true }).order('pathway_step', { ascending: true }),
    ])
    const byNum = new Map((ph ?? []).map(p => [p.phase_number, p]))
    setPhases(PHASES.map(n => byNum.get(n) ?? { phase_number: n, status: 'locked', planned_start: null, planned_end: null }))

    // A project with no lanes at all can't show anything, and it's reachable by
    // deleting the seeded ones. Put Delivery and Change back rather than leaving
    // the chart empty with no obvious way forward.
    let laneRows = ln ?? []
    if (!laneRows.length && !readOnly) {
      const { data: seeded } = await supabase.from('project_lanes').insert([
        { project_id: project.id, name: 'Delivery', tint: '#eff6ff', sort_order: 0 },
        { project_id: project.id, name: 'Change',   tint: '#f0fdfa', sort_order: 1 },
      ]).select()
      laneRows = seeded ?? []
    }
    setLanes(laneRows)
    const ln2 = laneRows
    // Legacy rows predate lane_id and carry a 'delivery'/'change' text lane instead.
    // Resolve them to a lane row by name so the two never diverge on screen.
    const laneByName = new Map(ln2.filter(l => !l.parent_id).map(l => [l.name.toLowerCase(), l.id]))
    setMilestones((ms ?? []).map(m => ({ ...m, lane_id: m.lane_id ?? laneByName.get((m.lane ?? '').toLowerCase()) ?? null })))

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

    // An activity bar reports how many of the assigned members have ticked it off.
    // That figure already exists, so the timeline reads it rather than asking anyone
    // to keep a second percentage up to date by hand.
    const perContent = {}
    acts.forEach(a => { perContent[a.content_id] = (perContent[a.content_id] || 0) + 1 })
    const team = Math.max(memberIds.length, 1)
    setActivities((dated ?? []).map(a => ({
      ...a,
      name: a.phase_content?.title ?? 'Untitled activity',
      pct: Math.round(((perContent[a.content_id] || 0) / team) * 100),
    })))
    const prog = {}
    PHASES.forEach(n => { prog[n] = { done: dCount[n] || 0, total: (cCount[n] || 0) * Math.max(memberIds.length, 1) } })
    setProgress(prog)

    // Same underlying facts, expressed per exercise, so the lane roll-up can apply the
    // equal-weight rule from analysis.js instead of this file inventing its own.
    const ex = {}
    ;(pathway ?? []).forEach(r => {
      ;(ex[r.phase_number] ||= []).push({ id: r.content_id, completedBy: perContent[r.content_id] || 0 })
    })
    setPhaseEx(ex)
    setTeamSize(team)
    setLoading(false)
  }

  // Apply an edit to local state immediately, so the chart updates on the spot and
  // the follow-up refetch just confirms it rather than being the thing you wait for.
  function patchRow(table, id, patch) {
    const setter = table === 'project_pathways' ? setActivities : setMilestones
    setter(prev => prev.map(x => x.id === id ? { ...x, ...patch } : x))
  }

  async function saveMilestone() {
    setMsSaving(true)
    if (msForm.phaseNumber) {
      const existing = phases.find(p => p.phase_number === msForm.phaseNumber)
      const dates = { planned_start: msForm.starts_on || null, planned_end: msForm.ends_on || null }
      if (existing?.id) await supabase.from('project_phases').update(dates).eq('id', existing.id)
      else await supabase.from('project_phases').insert({ project_id: project.id, phase_number: msForm.phaseNumber, status: existing?.status ?? 'locked', ...dates })
      setMsSaving(false); setMsForm(null); load({ quiet: true })
      return
    }
    // An activity row belongs to the pathway; the timeline only schedules and colours it.
    if (msForm.activityId) {
      await supabase.from('project_pathways').update({
        starts_on: msForm.starts_on || null,
        ends_on:   msForm.ends_on || null,
        lane_id:   msForm.lane_id || null,
        color:     msForm.color || null,
        sort_order: Number(msForm.sort_order) || 0,
      }).eq('id', msForm.activityId)
      setMsSaving(false); setMsForm(null); load({ quiet: true })
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
      sort_order: Number(msForm.sort_order) || 0,
      // A point milestone is either reached or not; a percentage on it is meaningless.
      pct: msForm.kind === 'band' ? (Number(msForm.pct) || 0) : 0,
    }
    if (msForm.id) await supabase.from('project_milestones').update(payload).eq('id', msForm.id)
    else           await supabase.from('project_milestones').insert(payload)
    setMsSaving(false)
    setMsForm(null)
    load({ quiet: true })
  }

  async function deleteMilestone(id) {
    if (!window.confirm('Delete this timeline item?')) return
    await supabase.from('project_milestones').delete().eq('id', id)
    load({ quiet: true })
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
    load({ quiet: true })
  }

  async function deleteLane(lane) {
    const kids = lanes.filter(l => l.parent_id === lane.id).length
    const rows = rowsForLane(lane.id, milestones, scopedActivities).length
    const warn = kids || rows
      ? `Delete “${lane.name}”? Its ${kids ? `${kids} sub-lane(s) and ` : ''}${rows} item(s) stay in the project but lose their lane.`
      : `Delete “${lane.name}”?`
    if (!window.confirm(warn)) return
    // ON DELETE SET NULL on both FKs means bars survive; they just fall out of a lane.
    await supabase.from('project_lanes').delete().eq('id', lane.id)
    load({ quiet: true })
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
      // Phases are addressed by phase_number everywhere else — in live(), in DragTip,
      // and in the update's .eq(). They also carry a uuid id from the table, and
      // preferring that silently broke both preview and save: the preview never
      // matched the row, and the update ran .eq('phase_number', <uuid>) against nothing.
      id: table === 'project_phases' ? item.phase_number : item.id,
      mode, table, item,
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
      dragRef.current.lastX = e2.clientX
      dragRef.current.lastY = e2.clientY
      // Which lane is under the cursor right now? Used both for the live hint and
      // for the drop. Read from the DOM rather than computing row maths, so it
      // stays correct however the lanes are nested or sized.
      const el = document.elementFromPoint(e2.clientX, e2.clientY)
      dragRef.current.overLane = el?.closest('[data-lane-id]')?.getAttribute('data-lane-id') ?? null
      bump()
    }
    const up = async () => {
      window.removeEventListener('pointermove', move)
      const d = dragRef.current
      dragRef.current = null; bump()
      if (!d) return

      // A press that didn't really move is a click: open the item's details.
      // 4px of slop covers the wobble in a normal click without swallowing a
      // deliberate nudge, which would silently discard a one-day drag.
      if (d.mode === 'move' && Math.abs(d.dx) < 4 && Math.abs(d.dy) < 4) {
        openRowEditor(d.table === 'project_phases' ? { ...d.item, table: 'project_phases' } : d.item)
        return
      }

      // Dropped over a different lane? Move it there. This takes priority over
      // reordering — you can't meaningfully do both in one gesture, and the lane
      // change is the bigger intent.
      const crossLane = d.mode === 'move' && d.laneId && d.overLane && d.overLane !== d.laneId
      if (crossLane) {
        patchRow(d.table, d.id, { lane_id: d.overLane })   // move it on screen straight away
        await supabase.from(d.table).update({ lane_id: d.overLane }).eq('id', d.id)
        if (!d.dx) { load({ quiet: true }); return }
      }

      // Vertical drag reorders the row within its lane. Phases keep their fixed 1–5 sequence.
      const steps = Math.round(d.dy / ROW_H)
      if (!crossLane && steps && d.laneId && d.mode === 'move') {
        const lane = rowsForLane(d.laneId, milestones, scopedActivities)
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

      if (!d.dx) { if (steps) load({ quiet: true }); return }
      const p = dragPreview({ ...d })
      if (!p) return
      // Paint the new dates locally first. Waiting on the round-trip is what made a
      // drag snap back to the old position for a moment before settling.
      // Every branch reports rows touched, so a write that matches nothing is loud
      // instead of looking like a successful drag that quietly reverts on refresh.
      let res
      if (d.table === 'project_phases') {
        setPhases(prev => prev.map(x => x.phase_number === d.id ? { ...x, planned_start: p.s, planned_end: p.e } : x))
        res = await supabase.from('project_phases').update({ planned_start: p.s, planned_end: p.e })
          .eq('project_id', project.id).eq('phase_number', d.id).select('phase_number')
      } else if (d.table === 'project_pathways') {
        patchRow(d.table, d.id, { starts_on: p.s, ends_on: p.e })
        res = await supabase.from('project_pathways').update({ starts_on: p.s, ends_on: p.e }).eq('id', d.id).select('id')
      } else if (p.e) {
        patchRow(d.table, d.id, { starts_on: p.s, ends_on: p.e })
        res = await supabase.from('project_milestones').update({ starts_on: p.s, ends_on: p.e }).eq('id', d.id).select('id')
      } else {
        patchRow(d.table, d.id, { milestone_date: p.s })
        res = await supabase.from('project_milestones').update({ milestone_date: p.s }).eq('id', d.id).select('id')
      }
      if (res?.error || !res?.data?.length) {
        console.error('Timeline: drag did not save', { table: d.table, id: d.id, error: res?.error })
        window.alert('That change could not be saved. The chart will reload to show the stored dates.')
      }
      load({ quiet: true })
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

  // Grab handles on a band: middle moves, edges resize. z-[6] keeps them above the
  // bar — in the phase rows the handles are painted first, so without it the bar
  // covers them and the edges simply can't be grabbed.
  const handleStyle = 'absolute top-0 h-full w-2 cursor-ew-resize z-[6]'
  const DragTip = ({ id }) => {
    void dragTick            // re-render on every pointer move while dragging
    const d = dragRef.current
    if (!d || d.id !== id) return null
    const p = dragPreview(d)
    if (!p) return null
    const txt = p.e ? `${fmtLong(toDate(p.s))} → ${fmtLong(toDate(p.e))}` : fmtLong(toDate(p.s))
    const steps = Math.round(d.dy / ROW_H)
    const target = d.overLane && d.overLane !== d.laneId ? lanes.find(l => l.id === d.overLane) : null
    const rowMove = target ? ` · → ${target.name}`
      : (steps && d.laneId && d.mode === 'move')
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
  // Phases the client is not running. Their pathway content still exists in the
  // database — deferring a phase does not delete the work planned for it — so it has to
  // be kept off the chart deliberately. Otherwise the chart says a phase is not in this
  // programme while still drawing its exercises as bars with dates and percentages.
  const deferredNums = new Set(
    phases.some(p => p.id) ? phases.filter(p => !p.lane_id).map(p => p.phase_number) : [],
  )
  const scopedActivities = activities.filter(a => !deferredNums.has(a.phase_number))
  // Counted, not just dropped. Hiding content silently is how a chart starts lying by
  // omission; the deferred strip below says how much is sitting out of scope.
  const outOfScopeCount = activities.length - scopedActivities.length

  const rowsIn = laneId => rowsForLane(laneId, milestones, scopedActivities)
  // Lane currently under the cursor mid-drag, when it isn't the row's own lane.
  const dropLane = (dragTick, dragRef.current?.overLane && dragRef.current.overLane !== dragRef.current.laneId)
    ? dragRef.current.overLane : null

  // One line of the chart. A line can hold several items — a band and the milestone
  // that closes it, say — so the drawing loop is per item and the label column
  // joins their names. Items share a line by sharing a sort_order.
  const TimelineRow = ({ group, accent, dim, depth = 0 }) => {
    const multi = group.items.length > 1
    const dateText = i => (i.starts_on && i.ends_on)
      ? `${fmtShort(toDate(i.starts_on))} – ${fmtShort(toDate(i.ends_on))}`
      : (i.milestone_date ? fmtShort(toDate(i.milestone_date)) : 'No dates set')
    const anyUndated = group.items.some(i => i.undated)
    return (
      <div className="flex items-center border-b border-slate-50 group">
        {/* Nesting indents the LABEL only. Indenting the row would shift the track
            and every bar in a sub-lane would sit at the wrong date. */}
        <div className="w-[190px] shrink-0 pr-3" style={{ paddingLeft: 12 + depth * 14 }}>
          <p className={`text-xs font-semibold truncate ${anyUndated ? 'text-slate-400' : ''}`}
            style={anyUndated ? {} : { color: accent }} title={group.label}>{group.label}</p>
          <p className={`text-[10px] truncate ${anyUndated ? 'text-amber-500' : 'text-slate-400'}`}>
            {multi ? group.items.map(dateText).join('  ·  ') : dateText(group.items[0])}
          </p>
        </div>
        <div className="relative flex-1 h-8" style={{ width: trackW }}>
          <MonthGrid />
          <TodayLine />
          {group.ordered.map(r => {
            const isBand = r.starts_on && r.ends_on
            if (isBand) {
              const lv = live(r.id, r.starts_on, r.ends_on)
              const bx = posOf(lv.s)
              const bw = Math.max(posOf(lv.e) - bx, 8)
              // With several items on a line there is no room for outside labels;
              // the label column already lists them.
              const inside = bw >= estTextW(r.name)
              const outRight = bx + bw + estTextW(r.name) <= trackW
              return (
                <Fragment key={`${r.table}-${r.id}`}>
                  <DragTip id={r.id} />
                  <div onPointerDown={e => beginDrag(e, r, 'move', r.table)}
                    title={readOnly ? '' : 'Drag to move · drag an edge to change duration · drag onto another lane to move it there'}
                    className={`absolute top-1.5 h-5 rounded flex items-center px-1.5 overflow-hidden ${readOnly ? '' : 'cursor-grab active:cursor-grabbing'}`}
                    style={{ left: bx, width: bw, background: tintOf(r.color || dim), border: `1px solid ${r.color || dim}`, ...(dragLift(r.id) || {}) }}>
                    {/* Completed portion, drawn in the bar's own colour against a
                        lightened track — so the fill reads as progress rather than
                        as a differently-coloured bar. */}
                    {r.pct > 0 && (
                      <div className="absolute inset-y-0 left-0 rounded-l" style={{ width: `${r.pct}%`, background: r.color || dim }} />
                    )}
                    {inside && <span className="relative text-[10px] font-semibold whitespace-nowrap select-none" style={{ color: r.pct >= 60 ? (onColor(r.color) || accent) : accent }}>{r.name}</span>}
                  </div>
                  {!readOnly && (
                    <>
                      <div className={handleStyle} style={{ left: bx - 3 }} onPointerDown={e => beginDrag(e, r, 'start', r.table)} />
                      <div className={handleStyle} style={{ left: bx + bw - 5 }} onPointerDown={e => beginDrag(e, r, 'end', r.table)} />
                    </>
                  )}
                  {!inside && !multi && (
                    <span className="absolute top-2 text-[10px] font-semibold whitespace-nowrap" style={{ color: accent, ...(outRight ? { left: bx + bw + 4 } : { left: Math.max(bx - estTextW(r.name) - 4, 2) }) }}>{r.name}</span>
                  )}
                  {/* Span in dd/mm at the tail of the bar, so a date can be read off the
                      chart without hunting for the row's label column. */}
                  <span className="absolute top-2.5 text-[9px] text-slate-400 whitespace-nowrap pointer-events-none"
                    style={{ left: bx + bw + (inside || multi ? 4 : estTextW(r.name) + 8) }}>
                    {ddmm(lv.s)}–{ddmm(lv.e)}
                  </span>
                </Fragment>
              )
            }
            if (r.milestone_date) {
              const dx = posOf(live(r.id, r.milestone_date, null).s)
              const labelRight = dx + 12 + estTextW(r.name) <= trackW
              return (
                <Fragment key={`${r.table}-${r.id}`}>
                  <DragTip id={r.id} />
                  <div className={`absolute z-[8] ${readOnly ? '' : 'cursor-grab active:cursor-grabbing'}`} style={{ left: dx - 7, top: 6, ...(dragLift(r.id) || {}) }}
                    title={readOnly ? '' : 'Drag to move this milestone'}
                    onPointerDown={e => beginDrag(e, r, 'move', r.table)}>
                    <svg width="16" height="16" viewBox="0 0 16 16"><path d="M8 0 l8 8 -8 8 -8 -8 z" fill={r.color || accent} stroke="#fff" strokeWidth="1.5" /></svg>
                  </div>
                  {!multi && (
                    <span className="absolute top-2 text-[10px] font-semibold whitespace-nowrap z-[8]" style={{ color: accent, ...(labelRight ? { left: dx + 11 } : { left: Math.max(dx - estTextW(r.name) - 11, 2) }) }}>{r.name}</span>
                  )}
                  <span className="absolute top-2.5 text-[9px] text-slate-400 whitespace-nowrap pointer-events-none z-[8]"
                    style={{ left: dx + 11 + (multi ? 0 : estTextW(r.name)) }}>
                    {ddmm(live(r.id, r.milestone_date, null).s)}
                  </span>
                </Fragment>
              )
            }
            return null
          })}
          {group.items.every(i => !i.starts_on && !i.milestone_date) && (
            <span className="absolute top-2 left-2 text-[10px] text-slate-300 italic">not scheduled</span>
          )}
        </div>
        {!readOnly && (
          <div className="w-16 shrink-0 pr-2 text-right opacity-0 group-hover:opacity-100 transition-opacity leading-tight">
            {group.items.map(r => (
              <div key={`${r.table}-${r.id}`}>
                <button onClick={() => openRowEditor(r)} className="text-[10px] hover:underline" style={{ color: accent }}
                  title={`Edit ${r.name}`}>{multi ? r.name.slice(0, 6) : 'Edit'}</button>
                {r.table === 'project_milestones' && (
                  <button onClick={() => deleteMilestone(r.id)} className="text-[10px] text-red-400 hover:underline ml-1.5"
                    title={`Delete ${r.name}`}>Del</button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    )
  }

  // Activities are owned by the pathway, so the timeline edits their dates and colour
  // but never their name or existence — that stays in the pathway builder.
  function openRowEditor(r) {
    // A ChangeFlow phase has a fixed name and status-driven colour; only its dates
    // are the user's to set, so the dialog opens with just those enabled.
    if (r.table === 'project_phases') {
      setMsForm({ ...emptyMs, phaseNumber: r.phase_number, name: `0${r.phase_number} ${PHASE_NAMES[r.phase_number]}`,
        kind: 'band', starts_on: r.planned_start ?? '', ends_on: r.planned_end ?? '' })
      return
    }
    if (r.table === 'project_pathways') {
      setMsForm({ ...emptyMs, activityId: r.id, name: r.name, kind: 'band', lane_id: r.lane_id,
        starts_on: r.starts_on ?? '', ends_on: r.ends_on ?? '', color: r.color ?? '', sort_order: r.sort_order ?? 0,
        derivedPct: r.pct ?? 0 })
      return
    }
    const m = milestones.find(x => x.id === r.id) ?? r
    setMsForm({ ...emptyMs, ...m, kind: (m.starts_on && m.ends_on) ? 'band' : 'point',
      milestone_date: m.milestone_date ?? '', starts_on: m.starts_on ?? '', ends_on: m.ends_on ?? '', color: m.color ?? '',
      sort_order: m.sort_order ?? 0, pct: m.pct ?? 0 })
  }

  // Lane bands span the full width with no side borders or horizontal padding, so
  // every row in the chart shares one track origin. Depth is expressed by indenting
  // the label column and by the header, never by insetting the band itself.
  // ── Change phases, grouped by lane ──────────────────────────────────────────
  // Lane membership IS scope: a phase in a lane is being run, a phase in none is a
  // later programme. So this both groups the chart and decides what belongs on it.
  // Deferred phases are listed at the bottom without bars — they have no dates and no
  // percentage, and drawing them as empty tracks would read as "late", not "not ours".
  const phaseGroups = (() => {
    const laneById = new Map(lanes.map(l => [l.id, l]))
    // A project whose phases have never been saved has not chosen a scope yet. Treat
    // all five as in scope, matching the project card — the same state has to give the
    // same answer in both places, or the picker and the chart contradict each other.
    const unsaved  = !phases.some(p => p.id)
    const inScope  = unsaved ? phases : phases.filter(p => p.lane_id)
    const deferred = unsaved ? []     : phases.filter(p => !p.lane_id)
    const byLane = new Map()
    for (const p of inScope) {
      const key = p.lane_id ?? '__unscoped__'
      if (!byLane.has(key)) byLane.set(key, [])
      byLane.get(key).push(p)
    }
    const ordered = [...byLane.entries()]
      .map(([id, ps]) => ({ lane: laneById.get(id) ?? { id, name: 'Change programme', tint: '#eff6ff', sort_order: 0 }, phases: ps }))
      .sort((a, b) => (a.lane.sort_order ?? 0) - (b.lane.sort_order ?? 0))
    // Percentages come from the tested helper, not from a formula written here. The
    // timeline, the report and CORA then cannot disagree about how far through a lane a
    // client is — which is the whole reason the maths lives in analysis.js.
    const rolled = laneProgress(
      ordered.flatMap(g => g.phases.map(p => ({
        laneId: g.lane.id, laneName: g.lane.name, laneTint: g.lane.tint,
        name: PHASE_NAMES[p.phase_number], exercises: phaseEx[p.phase_number] ?? [],
      }))),
      { members: teamSize },
    )
    const pctByLane = new Map(rolled.map(l => [l.laneId, l]))
    return { groups: ordered.map(g => ({ ...g, roll: pctByLane.get(g.lane.id) ?? null })), deferred }
  })()

  const LaneBand = ({ lane, depth = 0 }) => {
    const st = laneStyle(lane.tint)
    const rows = rowsIn(lane.id)
    const nested = depth > 0
    return (
      <div data-lane-id={lane.id}
        style={{
          background: nested ? '#ffffff' : st.tint,
          borderTop: `1px solid ${st.border}`, borderBottom: `1px solid ${st.border}`,
          // Highlight the lane you're about to drop into.
          outline: dropLane === lane.id ? `2px solid ${st.text}` : 'none', outlineOffset: -2,
        }}>
        <div className="flex items-center justify-between pr-3 pt-2 pb-1 group/lane" style={{ paddingLeft: 12 + depth * 14 }}>
          <span className={`font-semibold ${nested ? 'text-[10px]' : 'text-[11px]'}`} style={{ color: st.text }}>
            {nested && <span className="opacity-50 mr-1">↳</span>}{lane.name}
          </span>
          {!readOnly && (
            <span className="flex gap-2 opacity-60 group-hover/lane:opacity-100 transition-opacity">
              <button onClick={() => setLaneForm({ ...lane })} className="text-[10px] hover:underline" style={{ color: st.text }}>Edit lane</button>
              {!nested && <button onClick={() => setLaneForm({ project_id: project.id, parent_id: lane.id, name: '', tint: '#f8fafc', sort_order: (lane.children?.length ?? 0) })} className="text-[10px] hover:underline" style={{ color: st.text }}>+ Sub-lane</button>}
              {/* Delete lives inside the edit dialog, not here. Sitting one pixel from
                  Edit it was far too easy to hit, and there is no undo. */}
            </span>
          )}
        </div>
        {rows.length === 0 && (lane.children?.length ?? 0) === 0 && (
          <div className="pb-2 text-[11px] text-slate-400" style={{ paddingLeft: 12 + depth * 14 }}>Nothing in this lane yet.</div>
        )}
        {groupLaneRows(rows).map(g => <TimelineRow key={g.key} group={g} accent={st.text} dim={st.border} depth={depth} />)}
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
            {/* CHANGEFLOW phases, inside their lanes */}
            {phaseGroups.groups.map(g => {
              const gst  = laneStyle(g.lane.tint)
              const scored = phaseGroups.groups.reduce((n, x) => n + x.phases.length, 0)
              return (
              <div key={g.lane.id} style={{ background: gst.tint, borderTop: `1px solid ${gst.border}` }}>
                <div className="flex items-center justify-between pr-3 pt-2 pb-1" style={{ paddingLeft: 12 }}>
                  <span className="text-[11px] font-semibold" style={{ color: gst.text }}>{g.lane.name}</span>
                  {/* The weight is stated here because this is where it is decided. A
                      phase is worth 100/(phases in scope) of the programme, so the same
                      phase is worth more on a narrowed programme than on a full one. */}
                  <span className="text-[10px]" style={{ color: gst.text, opacity: 0.75 }}>
                    {/* A lane with no exercises authored yet has no percentage — not 0%.
                        Nothing has been asked of anyone, so nothing is outstanding. */}
                    {g.roll?.pct != null ? `${g.roll.pct}% of this lane · ` : 'not yet measurable · '}
                    {g.phases.length} phase{g.phases.length !== 1 ? 's' : ''}
                    {scored > 0 && ` · ${Math.round((100 / scored) * 10) / 10}% each`}
                  </span>
                </div>
            {g.phases.map(p => {
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
              </div>
              )
            })}

            {/* Not in this programme. Named, not hidden: a reader has to be able to see
                that the other phases exist and were deliberately left out, otherwise the
                chart looks like a methodology with pieces missing. */}
            {phaseGroups.deferred.length > 0 && (
              <div className="border-t border-slate-100 bg-slate-50/60 px-3 py-2">
                <p className="text-[10px] font-bold tracking-widest text-slate-400 mb-1">NOT IN THIS PROGRAMME</p>
                <div className="flex flex-wrap gap-x-3 gap-y-1">
                  {phaseGroups.deferred.map(p => (
                    <span key={p.phase_number} className="text-[11px] text-slate-400">
                      {`0${p.phase_number} ${PHASE_NAMES[p.phase_number]}`}
                    </span>
                  ))}
                </div>
                <p className="text-[10px] text-slate-400 mt-1">
                  Excluded from every percentage.
                  {outOfScopeCount > 0 && ` ${outOfScopeCount} planned ${outOfScopeCount === 1 ? 'activity is' : 'activities are'} hidden with ${phaseGroups.deferred.length === 1 ? 'it' : 'them'} — kept, not deleted.`}
                  {' '}Add {phaseGroups.deferred.length === 1 ? 'it' : 'them'} to a lane on the project card to bring {phaseGroups.deferred.length === 1 ? 'it' : 'them'} into scope.
                </p>
              </div>
            )}
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


      {/* Milestone form modal */}
      {msForm && (
        <>
          <div className="fixed inset-0 bg-black/40 z-40" onClick={() => setMsForm(null)} />
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 pointer-events-none">
            <div className="bg-white rounded-2xl shadow-2xl pointer-events-auto w-full max-w-md">
              <div className="px-6 py-5 border-b border-slate-100 flex items-center justify-between">
                <h3 className="font-bold text-slate-800">{msForm.phaseNumber ? 'Phase dates' : msForm.activityId ? 'Schedule activity' : msForm.id ? 'Edit timeline item' : 'New timeline item'}</h3>
                <button onClick={() => setMsForm(null)} className="w-7 h-7 rounded-full bg-slate-100 flex items-center justify-center text-slate-500 text-xs">✕</button>
              </div>
              <div className="px-6 py-5 space-y-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">Name {msForm.activityId || msForm.phaseNumber ? '' : '*'}</label>
                  <input value={msForm.name} onChange={e => setMsForm({ ...msForm, name: e.target.value })} autoFocus={!msForm.activityId && !msForm.phaseNumber}
                    disabled={!!msForm.activityId || !!msForm.phaseNumber}
                    placeholder="e.g. Go-Live" className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#1F4E79] disabled:bg-slate-50 disabled:text-slate-500" />
                  {msForm.activityId && <p className="text-[10px] text-slate-400 mt-1">Activity names come from the pathway. Rename it there.</p>}
                </div>
                {!msForm.phaseNumber && (
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
                )}
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

                {!msForm.phaseNumber && (
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">Line</label>
                  <select value={String(msForm.sort_order ?? 0)} onChange={e => setMsForm({ ...msForm, sort_order: Number(e.target.value) })}
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:border-[#1F4E79]">
                    {(() => {
                      const existing = groupLaneRows(rowsIn(msForm.lane_id)).filter(g => g.items.some(i => i.id !== msForm.id && i.id !== msForm.activityId))
                      const nextFree = existing.length ? Math.max(...existing.map(g => g.sort_order)) + 1 : 0
                      const onOwn = !existing.some(g => g.sort_order === Number(msForm.sort_order ?? 0))
                      return (
                        <>
                          <option value={onOwn ? String(msForm.sort_order ?? 0) : String(nextFree)}>Its own line</option>
                          {existing.map(g => (
                            <option key={g.sort_order} value={String(g.sort_order)}>Share with: {g.label}</option>
                          ))}
                        </>
                      )
                    })()}
                  </select>
                  <p className="text-[10px] text-slate-400 mt-1">Put a milestone on the same line as the band it closes — Go-Live on Build, say.</p>
                </div>
                )}

                {!msForm.phaseNumber && msForm.kind === 'band' && (
                  <div>
                    <label className="block text-xs font-semibold text-slate-600 mb-1">Complete</label>
                    {msForm.activityId ? (
                      <p className="text-[11px] text-slate-500 bg-slate-50 rounded-lg px-3 py-2">
                        {msForm.derivedPct ?? 0}% — taken from how many assigned members have ticked this activity off. Not editable here.
                      </p>
                    ) : (
                      <div className="flex items-center gap-2">
                        <input type="range" min="0" max="100" step="5" value={Number(msForm.pct) || 0}
                          onChange={e => setMsForm({ ...msForm, pct: Number(e.target.value) })}
                          className="flex-1 accent-[#1F4E79]" />
                        <span className="text-xs font-semibold text-slate-700 w-10 text-right">{Number(msForm.pct) || 0}%</span>
                      </div>
                    )}
                  </div>
                )}

                {!msForm.phaseNumber && (
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
                )}
                {msForm.phaseNumber && (
                  <p className="text-[11px] text-slate-500 bg-slate-50 rounded-lg px-3 py-2">A ChangeFlow phase takes its name and colour from its status, so only the dates are editable here.</p>
                )}
              </div>
              <div className="px-6 py-4 border-t border-slate-100 flex justify-end gap-3">
                <button onClick={() => setMsForm(null)} className="text-sm text-slate-500 px-4 py-2">Cancel</button>
                <button onClick={saveMilestone} disabled={msSaving}
                  className="bg-[#1F4E79] text-white text-sm font-semibold px-6 py-2 rounded-lg hover:bg-[#163a5c] transition-colors disabled:opacity-60">
                  {msSaving ? 'Saving…' : msForm.id || msForm.activityId || msForm.phaseNumber ? 'Save' : 'Add'}
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
              <div className="px-6 py-4 border-t border-slate-100 flex justify-between items-center gap-3">
                {laneForm.id
                  ? <button onClick={() => { const l = laneForm; setLaneForm(null); deleteLane(l) }}
                      className="text-xs text-red-500 hover:underline">Delete lane</button>
                  : <span />}
                <div className="flex gap-3">
                <button onClick={() => setLaneForm(null)} className="text-sm text-slate-500 px-4 py-2">Cancel</button>
                <button onClick={saveLane} disabled={!laneForm.name.trim()}
                  className="bg-[#1F4E79] text-white text-sm font-semibold px-6 py-2 rounded-lg hover:bg-[#163a5c] transition-colors disabled:opacity-60">
                  {laneForm.id ? 'Save' : 'Add'}
                </button>
                </div>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
