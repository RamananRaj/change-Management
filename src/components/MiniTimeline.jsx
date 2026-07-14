// Compact, read-only timeline strip. Shows the ChangeFlow phases as a band across a
// month scale with a "today" line and milestone diamonds. Used on dashboards.
// Props: phases = [{ phase_number, name, planned_start, planned_end, status, pct }]
//        milestones = [{ name, milestone_date, color }]

const PHASE_NAMES = { 1: 'Diagnose', 2: 'Design', 3: 'Engage', 4: 'Embed', 5: 'Evaluate' }

export default function MiniTimeline({ phases = [], milestones = [] }) {
  const dates = []
  phases.forEach(p => { if (p.planned_start) dates.push(new Date(p.planned_start)); if (p.planned_end) dates.push(new Date(p.planned_end)) })
  milestones.forEach(m => { if (m.milestone_date) dates.push(new Date(m.milestone_date)) })
  if (dates.length === 0) {
    return <p className="text-xs text-slate-400">No dates scheduled yet.</p>
  }

  const min = new Date(Math.min(...dates)), max = new Date(Math.max(...dates))
  const start = new Date(min.getFullYear(), min.getMonth(), 1)
  const end   = new Date(max.getFullYear(), max.getMonth() + 1, 0)
  const span  = (end - start) || 1
  const pos   = d => Math.max(0, Math.min(100, ((new Date(d) - start) / span) * 100))

  const today   = new Date()
  const todayIn = today >= start && today <= end

  const months = []
  let cur = new Date(start)
  while (cur <= end) { months.push(new Date(cur)); cur = new Date(cur.getFullYear(), cur.getMonth() + 1, 1) }

  const fill = p => {
    if (p.pct >= 100 || p.status === 'completed') return '#16a34a'
    if (p.planned_start && p.planned_end) {
      const s = new Date(p.planned_start), e = new Date(p.planned_end)
      if (today >= s && today <= e) return '#E8913A'   // in progress
      if (today > e) return '#E8913A'                   // overdue, underway
    }
    return '#cbd5e1'                                     // upcoming
  }

  const scheduled = phases.filter(p => p.planned_start && p.planned_end)

  return (
    <div>
      {/* Month scale */}
      <div className="relative h-4 mb-1 border-b border-slate-100">
        {months.map((mn, i) => (
          <span key={i} className="absolute text-[10px] text-slate-400 -translate-x-0" style={{ left: `${pos(mn)}%` }}>
            {mn.toLocaleString('en', { month: 'short' })}
          </span>
        ))}
      </div>

      {/* Phase band */}
      <div className="relative">
        {todayIn && (
          <div className="absolute -top-1 bottom-0 w-px bg-red-400 z-10" style={{ left: `${pos(today)}%` }}>
            <span className="absolute -top-3 -translate-x-1/2 text-[8px] font-bold text-red-400">today</span>
          </div>
        )}
        <div className="space-y-1.5 py-1">
          {scheduled.length === 0 ? (
            <p className="text-xs text-slate-400">Phase dates not set yet.</p>
          ) : scheduled.map(p => {
            const left  = pos(p.planned_start)
            const width = Math.max(pos(p.planned_end) - left, 3)
            const bg    = fill(p)
            const name  = p.name ?? PHASE_NAMES[p.phase_number] ?? `Phase ${p.phase_number}`
            const wide  = width > 14
            return (
              <div key={p.phase_number} className="relative h-5">
                <div className="absolute h-5 rounded flex items-center px-1.5 overflow-hidden" style={{ left: `${left}%`, width: `${width}%`, background: bg }}>
                  {wide && <span className="text-[10px] font-semibold text-white truncate">{name}</span>}
                </div>
                {!wide && (
                  <span className="absolute text-[10px] font-medium text-slate-500 whitespace-nowrap" style={{ left: `calc(${left}% + ${width}% + 4px)`, top: '3px' }}>{name}</span>
                )}
              </div>
            )
          })}
        </div>

        {/* Milestone diamonds */}
        {milestones.filter(m => m.milestone_date).map((m, i) => (
          <div key={i} className="absolute -bottom-1" style={{ left: `${pos(m.milestone_date)}%` }} title={`${m.name} · ${new Date(m.milestone_date).toLocaleDateString('en', { day: 'numeric', month: 'short' })}`}>
            <svg width="10" height="10" viewBox="0 0 16 16" className="-translate-x-1/2"><path d="M8 0 l8 8 -8 8 -8 -8 z" fill={m.color || '#1F4E79'} /></svg>
          </div>
        ))}
      </div>

      {/* Legend */}
      <div className="flex gap-3 mt-3 pt-2 text-[10px] text-slate-400">
        <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm inline-block" style={{ background: '#16a34a' }} />Done</span>
        <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm inline-block" style={{ background: '#E8913A' }} />In progress</span>
        <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm inline-block" style={{ background: '#cbd5e1' }} />Upcoming</span>
        <span className="flex items-center gap-1"><svg width="9" height="9" viewBox="0 0 16 16"><path d="M8 0 l8 8 -8 8 -8 -8 z" fill="#1F4E79" /></svg>Milestone</span>
      </div>
    </div>
  )
}
