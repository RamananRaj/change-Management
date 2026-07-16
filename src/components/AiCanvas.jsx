import { useEffect, useMemo, useRef, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { ask } from '../lib/ai/router'
import { loadSummary } from '../lib/ai/rules'
import { slmOptedIn } from '../lib/ai/slm'

// ChangeFlow · reusable AI Canvas experience.
// Collapsed KPI chips (glance layer) → grounded widgets in an open canvas → prompt bar.
// The tiered router (Rules → local SLM → external) is invisible here; it's implementation.
//
// Used two ways:
//   • standalone page  (/canvas)            → <AiCanvas fill />   fills the viewport
//   • inline on a dashboard (AI mode)       → <AiCanvas />        sits in a container
//
// `context` sets the one-line banner text. `onCollapseChips` is optional.

const SUGGESTIONS = [
  { label: "What's at risk this week?", q: "What's at risk this week?" },
  { label: 'Summarise readiness', q: 'Summarise readiness' },
  { label: "Who's behind on Phase 2?", q: "Who's behind on Phase 2?" },
  { label: 'Progress by project', q: 'Progress by project' },
  { label: 'Milestones due this week', q: 'Milestones due this week' },
]

const CHIP_QUERY = {
  readiness: 'Summarise readiness',
  progress: 'Progress by project',
  risk: "What's at risk this week?",
  timeline: 'Milestones due this week',
}

function Bold({ text }) {
  const parts = String(text ?? '').split(/(\*\*[^*]+\*\*)/g)
  return parts.map((p, i) => p.startsWith('**') && p.endsWith('**')
    ? <strong key={i} className="text-slate-800">{p.slice(2, -2)}</strong>
    : <span key={i}>{p}</span>)
}

function Widget({ d, onRemove }) {
  return (
    <div className="bg-white border border-slate-200 rounded-2xl shadow-sm mb-4 overflow-hidden animate-[fadeIn_.25s_ease]">
      <div className="flex items-center gap-3 px-5 py-3 border-b border-slate-100">
        <div className="min-w-0">
          {d.query && <p className="text-[11px] text-slate-400 truncate">"{d.query}"</p>}
          <p className="font-bold text-slate-800 text-[15px]">{d.title}</p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          {d.external && <span className="text-[10px] font-semibold text-amber-700 bg-amber-50 border border-amber-200 rounded-full px-2 py-0.5" title="Answered by an external model — left your environment">external</span>}
          <button onClick={onRemove} className="text-slate-300 hover:text-slate-500 text-lg leading-none">×</button>
        </div>
      </div>
      <div className="p-5">
        <WidgetBody d={d} />
        {d.commentary && (
          <div className="mt-4 rounded-lg bg-slate-50 border border-slate-200 border-l-[3px] border-l-[#1F4E79] px-4 py-3 text-[13.5px] leading-relaxed text-slate-600">
            <Bold text={d.commentary} />
          </div>
        )}
      </div>
    </div>
  )
}

function WidgetBody({ d }) {
  if (d.type === 'narrative')
    return <p className="text-[14px] leading-relaxed text-slate-700"><Bold text={d.body} /></p>

  if (d.type === 'list') {
    if (!d.rows?.length) return <p className="text-sm text-slate-400">{d.empty}</p>
    return (
      <div className="space-y-2">
        {d.rows.map((r, i) => (
          <div key={i} className="flex items-center gap-3 border border-slate-200 rounded-xl px-3 py-2.5">
            <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${r.rag === 'r' ? 'bg-red-500' : r.rag === 'a' ? 'bg-amber-500' : 'bg-green-500'}`} />
            <div className="min-w-0">
              <p className="font-semibold text-sm text-slate-800 truncate">{r.name}</p>
              <p className="text-xs text-slate-400 truncate">{r.meta}</p>
            </div>
            {r.due && <span className="ml-auto text-xs text-slate-400 shrink-0">{r.due}</span>}
          </div>
        ))}
      </div>
    )
  }

  if (d.type === 'progress') {
    if (!d.rows?.length) return <p className="text-sm text-slate-400">{d.empty}</p>
    return (
      <div className="space-y-2.5">
        {d.rows.map((r, i) => {
          const c = r.value >= 75 ? '#16A34A' : r.value >= 55 ? '#D97706' : '#DC2626'
          return (
            <div key={i} className="flex items-center gap-3">
              <div className="w-32 shrink-0 min-w-0">
                <p className="text-[13px] font-semibold text-slate-700 truncate">{r.label}</p>
                {r.sub && <p className="text-[10px] text-slate-400 truncate">{r.sub}</p>}
              </div>
              <div className="flex-1 h-3 bg-slate-100 rounded-full overflow-hidden">
                <div className="h-full rounded-full" style={{ width: `${r.value}%`, background: c }} />
              </div>
              <span className="w-11 text-right text-[13px] font-bold" style={{ color: c }}>{r.value}%</span>
            </div>
          )
        })}
      </div>
    )
  }
  return null
}

// `chips` (optional): the host's own KPI chips to show collapsed, so a dashboard keeps its
// existing metrics visible in AI mode. Each: { color, tag, label, value, query? }. When a
// chip has a `query`, clicking it drills into that AI answer; otherwise it's a static stat.
export default function AiCanvas({ fill = false, context = 'Ask anything about your programme — grounded in your data', showChips = true, chips = null }) {
  const { user, profile } = useAuth()
  const ctx = useMemo(() => ({ userId: user?.id ?? null, clientId: profile?.client_id ?? null }), [user, profile])

  const [summary, setSummary] = useState(null)
  const [chipsOpen, setChipsOpen] = useState(true)
  const [dockOpen, setDockOpen] = useState(false)   // start as the compact floating pill
  const [widgets, setWidgets] = useState([])
  const [thinking, setThinking] = useState(false)
  const [progress, setProgress] = useState(null)
  const [input, setInput] = useState('')
  const canvasRef = useRef(null)

  useEffect(() => { loadSummary().then(setSummary).catch(() => setSummary(null)) }, [])

  async function run(q) {
    if (!q?.trim() || thinking) return
    setThinking(true); setProgress(null)
    try {
      const d = await ask(q, ctx, { onProgress: p => setProgress(p?.text ?? null) })
      // De-dupe: replace any existing card with the same title, moved fresh to the top.
      setWidgets(w => [{ ...d, query: q, key: Date.now() }, ...w.filter(x => x.title !== d.title)])
    } catch {
      setWidgets(w => [{ type: 'narrative', title: 'Something went wrong', body: 'That query could not be answered. Please try again.', query: q, key: Date.now() }, ...w])
    } finally {
      setThinking(false); setProgress(null)
      if (canvasRef.current) canvasRef.current.scrollTop = 0
    }
  }

  function submit(e) { e?.preventDefault(); const q = input.trim(); if (q) { run(q); setInput('') } }

  // Chips to show: the host's own (dashboard KPIs) if provided, else the default AI summary.
  const defaultChips = [
    { color: '#1F4E79', tag: 'RAG', label: 'Readiness', value: summary?.rag ?? '—', query: CHIP_QUERY.readiness },
    { color: '#16A34A', tag: 'PROGRESS', label: 'On track', value: summary ? `${summary.pct}%` : '—', query: CHIP_QUERY.progress },
    { color: '#DC2626', tag: 'RISK', label: 'At risk', value: summary?.atRisk ?? '—', query: CHIP_QUERY.risk },
    { color: '#E8913A', tag: 'TIMELINE', label: 'Due ≤7d', value: summary?.dueSoon ?? '—', query: CHIP_QUERY.timeline },
  ]
  const chipList = chips ?? defaultChips

  const Chip = ({ c }) => {
    const clickable = !!c.query
    return (
      <button onClick={clickable ? () => run(c.query) : undefined} disabled={thinking && clickable}
        className={`shrink-0 min-w-[180px] bg-white rounded-xl px-3.5 py-2.5 shadow-sm flex items-center gap-3 border border-slate-100 transition-all text-left ${clickable ? 'hover:-translate-y-0.5 hover:shadow-md cursor-pointer disabled:opacity-60' : 'cursor-default'}`}
        style={{ borderTop: `3px solid ${c.color}` }}>
        <span className="text-[9.5px] tracking-wider font-bold text-white rounded px-1.5 py-0.5" style={{ background: c.color }}>{c.tag}</span>
        <span className="text-[13px] text-slate-500 font-semibold">{c.label}</span>
        <span className="ml-auto text-lg font-extrabold tracking-tight" style={{ color: c.color }}>{c.value}</span>
      </button>
    )
  }

  return (
    <div className={fill ? 'flex flex-col h-full bg-slate-50' : 'flex flex-col'}>
      <style>{`@keyframes fadeIn{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}`}</style>

      {/* Chip strip (glance layer) */}
      {showChips && (
        <div className="bg-gradient-to-br from-[#1F4E79] to-[#163a5c] px-5 pt-4 pb-3 shrink-0 rounded-t-xl">
          <div className="flex items-center gap-2 text-white/90 text-sm mb-3">
            <span className="w-3.5 h-3.5 bg-[#E8913A]" style={{ clipPath: 'polygon(25% 0,75% 0,100% 50%,75% 100%,25% 100%,0 50%)' }} />
            <span>{context}</span>
            {summary && <span className="ml-auto text-white/60 text-xs">{summary.projects} project{summary.projects === 1 ? '' : 's'} · readiness {summary.rag}</span>}
          </div>
          {chipsOpen && (
            <div className="flex gap-3 overflow-x-auto pb-1">
              {chipList.map((c, i) => <Chip key={i} c={c} />)}
            </div>
          )}
          <button onClick={() => setChipsOpen(o => !o)} className="text-[11px] text-white/60 hover:text-white mt-2">
            {chipsOpen ? '▾ collapse detail cards' : '▸ show detail cards'}
          </button>
        </div>
      )}

      {/* Canvas */}
      <div ref={canvasRef} className={`bg-slate-50 px-5 py-5 overflow-y-auto ${fill ? 'flex-1' : 'min-h-[46vh] max-h-[60vh]'}`}>
        {thinking && (
          <div className="bg-white border border-slate-200 rounded-2xl shadow-sm mb-4 px-5 py-4 flex items-center gap-3">
            <span className="w-4 h-4 rounded-full border-2 border-[#E8913A] border-t-transparent animate-spin" />
            <span className="text-sm text-slate-500">{progress || 'Thinking…'}</span>
          </div>
        )}
        {widgets.length === 0 && !thinking ? (
          <div className="h-full min-h-[36vh] flex flex-col items-center justify-center text-center gap-2 text-slate-400">
            <p className="text-lg font-bold text-slate-700">Ask ChangeFlow AI</p>
            <p className="max-w-md text-sm leading-relaxed">Answers are grounded in your real, role-scoped data. Tap a chip above or a suggestion below to begin.</p>
          </div>
        ) : (
          widgets.map(w => <Widget key={w.key} d={w} onRemove={() => setWidgets(list => list.filter(x => x.key !== w.key))} />)
        )}
      </div>

      {/* Prompt dock — collapsible. Open = full dock; collapsed = floating "Ask AI" pill. */}
      {dockOpen ? (
        <div className="bg-white border-t border-slate-200 px-5 pb-3 shrink-0 rounded-b-xl">
          <div className="flex justify-center">
            <button onClick={() => setDockOpen(false)}
              className="-mt-3 bg-white border border-slate-200 rounded-full px-3.5 py-1 text-[11px] font-semibold text-slate-500 shadow-sm hover:text-[#1F4E79] hover:border-slate-300 transition-colors">
              ▾ collapse
            </button>
          </div>
          <div className="pt-2">
            <div className="flex gap-2 overflow-x-auto pb-2.5">
              {SUGGESTIONS.map(s => (
                <button key={s.q} onClick={() => run(s.q)} disabled={thinking}
                  className="shrink-0 border border-slate-200 rounded-full px-3.5 py-2 text-[13px] text-[#1F4E79] hover:bg-slate-50 disabled:opacity-50 whitespace-nowrap">
                  {s.label}
                </button>
              ))}
            </div>
            <form onSubmit={submit} className="flex items-center gap-2.5 border-[1.5px] border-[#E8913A] rounded-2xl px-4 py-2.5" style={{ boxShadow: '0 0 0 3px rgba(232,145,58,.12)' }}>
              <span className="w-2.5 h-2.5 rounded-full bg-[#E8913A] shrink-0" />
              <input value={input} onChange={e => setInput(e.target.value)} disabled={thinking}
                placeholder="Ask AI anything — risks, readiness, progress, timelines…"
                className="flex-1 outline-none text-[15px] text-slate-800 placeholder:text-slate-400 disabled:opacity-60" />
              <button type="submit" disabled={thinking || !input.trim()}
                className="bg-[#E8913A] text-white rounded-xl w-9 h-8 font-bold disabled:opacity-50 hover:brightness-95">↑</button>
            </form>
            <p className="text-center text-[10px] text-slate-300 tracking-widest mt-2 font-mono">
              CHANGEFLOW · AI · GROUNDED &amp; ROLE-SCOPED{slmOptedIn() ? ' · ON-DEVICE SLM ON' : ''}
            </p>
          </div>
        </div>
      ) : (
        <div className="shrink-0 flex justify-center py-4 bg-slate-50">
          <button onClick={() => setDockOpen(true)} title="Open AI chat"
            className="flex items-center gap-3 bg-white border border-slate-200 rounded-full pl-4 pr-2 py-2 shadow-md hover:shadow-lg transition-shadow">
            <span className="w-2.5 h-2.5 rounded-full bg-[#E8913A] shrink-0" />
            <span className="text-[15px] text-slate-400 pr-1">Ask AI anything…</span>
            <span className="w-8 h-8 rounded-full bg-[#FDECD8] flex items-center justify-center text-[#E8913A] font-bold text-sm shrink-0">✦</span>
          </button>
        </div>
      )}
    </div>
  )
}
