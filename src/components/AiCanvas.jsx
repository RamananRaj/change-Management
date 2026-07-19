import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../lib/supabase'
import { ask } from '../lib/ai/router'
import { loadSummary, noteCorrection } from '../lib/ai/rules'
import { slmOptedIn } from '../lib/ai/slm'
import { buildTemplateDraft, createTemplate } from '../lib/ai/templateDraft'
import { saveReportEdits, promoteToStandard } from '../lib/ai/reportMemory'
import { rewriteReportNarratives } from '../lib/ai/reportStyle'
import { exportReportDoc, exportReportPptx } from '../lib/ai/reportExport'
import ProjectTimeline from './ProjectTimeline'

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
  { label: 'Upcoming milestones', q: 'Upcoming milestones' },
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

const RAG_DOT = { green: '#16A34A', amber: '#D97706', red: '#DC2626' }

function Widget({ d, onRemove, onDrill, onNavigate, onConfirmDraft, canAct }) {
  const showAction = d.action && (!d.action.adminOnly || canAct)
  return (
    <div className="bg-white border border-slate-200 rounded-2xl shadow-sm mb-4 animate-[fadeIn_.25s_ease]">
      <div className="flex items-center gap-3 px-5 py-3 border-b border-slate-100 rounded-t-2xl">
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
        <WidgetBody d={d} onDrill={onDrill} onNavigate={onNavigate} onConfirmDraft={onConfirmDraft} onCancel={onRemove} />
        {d.commentary && (
          <div className="mt-4 rounded-lg bg-slate-50 border border-slate-200 border-l-[3px] border-l-[#1F4E79] px-4 py-3 text-[13.5px] leading-relaxed text-slate-600">
            <Bold text={d.commentary} />
          </div>
        )}
        {showAction && (
          <button onClick={() => onNavigate?.(d.action.to)} className="mt-3 text-sm font-semibold text-[#1F4E79] hover:underline">
            {d.action.label}
          </button>
        )}
      </div>
    </div>
  )
}

// The report renders as a clean, printable document. Admins can edit the narrative sections
// in place; "Print" tags this element and a print stylesheet hides everything else; PowerPoint
// and Word exports read the (edited) sections.
function ReportBody({ d, onDrill, onNavigate }) {
  const { profile } = useAuth()
  const canEdit = !!(profile?.is_admin || profile?.is_client_admin)
  const [sections, setSections] = useState(d.sections ?? [])
  const [note, setNote] = useState(null)
  const [saving, setSaving] = useState(false)
  const ref = useRef(null)
  const originals = useRef(Object.fromEntries((d.sections ?? []).filter(s => s.type === 'narrative').map(s => [s.heading, s.body])))
  const report = { ...d, sections }
  const setBody = (i, body) => setSections(prev => prev.map((s, idx) => idx === i ? { ...s, body } : s))

  const collectEdits = () => {
    const edits = {}
    sections.forEach(s => { if (s.type === 'narrative' && s.body !== originals.current[s.heading]) edits[s.heading] = s.body })
    return edits
  }
  // Save edits for THIS client — adopted in that client's future reports.
  async function teachAI() {
    const edits = collectEdits()
    if (!Object.keys(edits).length) { setNote('No changes to save yet.'); return }
    setSaving(true)
    const err = await saveReportEdits(d.client_id, edits)
    setSaving(false)
    setNote(err ? `Could not save: ${err.message}` : '✓ Saved — adopted in future reports for this client.')
    if (!err) originals.current = { ...originals.current, ...edits }
  }
  // Opt-in on-device SLM pass: rewrite generated narrative in the learned style (facts kept).
  async function styleWithAI() {
    setSaving(true); setNote('Preparing on-device model…')
    try {
      const next = await rewriteReportNarratives(sections, p => setNote(p?.text ?? 'Styling…'))
      setSections(next)
      setNote('✨ Narrative restyled on-device — review, then Save & teach AI to keep it.')
    } catch {
      setNote('On-device model unavailable. Enable it (localStorage cf_ai_slm="on") on a WebGPU browser.')
    } finally { setSaving(false) }
  }
  // Promote edits to the platform STANDARD — every client inherits them (Master Admin only).
  async function promoteStandard() {
    const edits = collectEdits()
    if (!Object.keys(edits).length) { setNote('Edit a section first, then promote it.'); return }
    setSaving(true)
    const err = await promoteToStandard(edits)
    setSaving(false)
    setNote(err ? `Could not promote: ${err.message}` : '★ Promoted to the standard — all clients inherit this wording unless they override it.')
    if (!err) originals.current = { ...originals.current, ...edits }
  }
  // Export with visible feedback — an async export that silently rejects looks like "nothing
  // happened", so we surface success and any error in the toolbar note.
  async function doExport(kind) {
    setNote(kind === 'pptx' ? 'Building PowerPoint…' : 'Building Word…')
    try {
      if (kind === 'pptx') await exportReportPptx(report)
      else await exportReportDoc(report)
      setNote(kind === 'pptx' ? '✓ PowerPoint downloaded.' : '✓ Word downloaded.')
    } catch (e) {
      console.error('[report export]', e)
      setNote(`Export failed: ${e?.message || e}. Check pop-up/download settings and try again.`)
    }
  }
  // Print only the report: hide the app shell so there's no trailing blank space, and drop the
  // browser's own header/footer via @page margin 0 (content margins come from .cf-print padding).
  const doPrint = () => {
    const el = ref.current; if (!el) return
    const added = []
    el.classList.add('cf-print'); added.push([el, 'cf-print'])
    let node = el
    while (node && node.parentElement && node !== document.body) {
      const parent = node.parentElement
      parent.classList.add('cf-print-ancestor'); added.push([parent, 'cf-print-ancestor'])
      for (const ch of Array.from(parent.children)) {
        if (ch !== node) { ch.classList.add('cf-hide-print'); added.push([ch, 'cf-hide-print']) }
      }
      node = parent
    }
    window.print()
    setTimeout(() => added.forEach(([n, c]) => n.classList.remove(c)), 800)
  }
  return (
    <div ref={ref} className="cf-report">
      <div className="mb-1">
        <h1 className="text-[22px] font-extrabold text-[#1F4E79] leading-tight">{d.title}</h1>
        {d.subtitle && <p className="text-xs text-slate-400 mt-1">{d.subtitle}</p>}
        {canEdit && <p className="cf-no-print text-[11px] text-[#E8913A] mt-1">✎ Narrative sections are editable — your changes flow into the exports.</p>}
      </div>

      {/* Action toolbar — sticky at the top of the report, scrolls with content so it never
          covers the prompt bar. Hidden in print. */}
      <div className="cf-no-print sticky top-2 z-20 flex flex-wrap items-center gap-2 bg-white/95 backdrop-blur border border-slate-200 shadow-sm rounded-2xl px-3 py-2 mb-4">
        {canEdit && d.client_id && (
          <button onClick={teachAI} disabled={saving} className="text-sm font-semibold text-white bg-[#E8913A] rounded-lg px-4 py-2 hover:brightness-95 disabled:opacity-60">
            {saving ? 'Saving…' : '✦ Save & teach AI'}
          </button>
        )}
        {profile?.is_admin && (
          <button onClick={promoteStandard} disabled={saving} title="Make this the default wording for every client"
            className="text-sm font-semibold text-[#1F4E79] border border-[#1F4E79]/30 rounded-lg px-4 py-2 hover:bg-[#1F4E79]/5 disabled:opacity-60">
            ★ Promote to standard
          </button>
        )}
        {profile?.is_admin && slmOptedIn() && (
          <button onClick={styleWithAI} disabled={saving} title="Rewrite the narrative in your house style, on-device (facts preserved)"
            className="text-sm font-semibold text-violet-700 border border-violet-200 rounded-lg px-4 py-2 hover:bg-violet-50 disabled:opacity-60">
            ✨ Rewrite in our style
          </button>
        )}
        <button onClick={doPrint} className="text-sm font-semibold text-white bg-[#1F4E79] rounded-lg px-4 py-2 hover:bg-[#163a5c]">🖨 PDF</button>
        <button onClick={() => doExport('pptx')} className="text-sm font-semibold text-[#1F4E79] border border-slate-200 rounded-lg px-4 py-2 hover:bg-slate-50">📊 PowerPoint</button>
        <button onClick={() => doExport('doc')} className="text-sm font-semibold text-[#1F4E79] border border-slate-200 rounded-lg px-4 py-2 hover:bg-slate-50">📄 Word</button>
        {note && <span className="text-xs text-slate-500 basis-full">{note}</span>}
      </div>

      <div className="space-y-7 mt-5">
        {sections.map((s, i) => (
          <section key={i} style={{ breakInside: 'avoid' }}>
            <h3 className="flex items-center gap-2 text-[12px] font-bold text-[#1F4E79] uppercase tracking-widest mb-3 pb-1 border-b border-slate-100">
              {s.heading}
              {s.source === 'client' && <span className="cf-no-print text-[9px] font-semibold text-[#E8913A] bg-amber-50 border border-amber-200 rounded-full px-2 py-0.5 normal-case tracking-normal">✦ adopted from your edits</span>}
              {s.source === 'standard' && <span className="cf-no-print text-[9px] font-semibold text-[#1F4E79] bg-[#1F4E79]/8 border border-[#1F4E79]/20 rounded-full px-2 py-0.5 normal-case tracking-normal">★ platform standard</span>}
              {s.source === 'slm' && <span className="cf-no-print text-[9px] font-semibold text-violet-700 bg-violet-50 border border-violet-200 rounded-full px-2 py-0.5 normal-case tracking-normal">✨ AI-styled (on-device)</span>}
            </h3>
            {s.type === 'narrative' && canEdit ? (
              <>
                <textarea value={s.body ?? ''} onChange={e => setBody(i, e.target.value)}
                  rows={Math.max(2, Math.ceil((s.body ?? '').length / 95))}
                  className="cf-no-print w-full text-[14px] text-slate-700 leading-relaxed border border-dashed border-slate-300 rounded-lg px-3 py-2 focus:outline-none focus:border-[#1F4E79] resize-y" />
                <p className="hidden print:block text-[14px] leading-relaxed text-slate-700"><Bold text={s.body} /></p>
              </>
            ) : (
              <WidgetBody d={s} onDrill={onDrill} onNavigate={onNavigate} />
            )}
          </section>
        ))}
      </div>
    </div>
  )
}

function WidgetBody({ d, onDrill, onNavigate, onConfirmDraft, onCancel }) {
  // A row is clickable if it carries a drill query or a navigation target.
  const rowHandler = r => r.to && onNavigate ? () => onNavigate(r.to) : r.drill && onDrill ? () => onDrill(r.drill) : null
  if (d.type === 'narrative')
    return <p className="text-[14px] leading-relaxed text-slate-700"><Bold text={d.body} /></p>

  if (d.type === 'report') return <ReportBody d={d} onDrill={onDrill} onNavigate={onNavigate} />


  if (d.type === 'templateDraft') {
    const dr = d.draft
    const typeBadge = { text: 'bg-slate-100 text-slate-600', number: 'bg-blue-100 text-blue-700', date: 'bg-purple-100 text-purple-700', select: 'bg-amber-100 text-amber-700', rating: 'bg-green-100 text-green-700', checkbox: 'bg-slate-100 text-slate-600' }
    return (
      <div>
        <div className="grid grid-cols-2 gap-3 mb-4">
          {[['Title', dr.title], ['Phase', `0${dr.phase_number} · ${['Diagnose', 'Design', 'Engage', 'Embed', 'Evaluate'][dr.phase_number - 1]}`],
            ['Customer', dr.client_name ?? 'Global (all)'], ['Columns', `${dr.columns.length}`]].map(([k, v]) => (
            <div key={k} className="bg-slate-50 border border-slate-200 rounded-lg px-3 py-2">
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">{k}</p>
              <p className="text-sm font-semibold text-slate-800 truncate">{v}</p>
            </div>
          ))}
        </div>
        {!dr.client_name && <p className="text-xs text-amber-600 mb-3">No customer matched in your message — this will be created as a <b>global</b> template. Add the customer's name to scope it.</p>}
        <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2">Columns</p>
        <div className="border border-slate-200 rounded-xl divide-y divide-slate-100 mb-4 max-h-56 overflow-y-auto">
          {dr.columns.length === 0 ? <p className="text-sm text-slate-400 px-3 py-3">No columns found in the file's header row.</p> :
            dr.columns.map((c, i) => (
              <div key={i} className="flex items-center gap-2 px-3 py-2">
                <span className="text-sm text-slate-700 flex-1 truncate">{c.label}</span>
                <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${typeBadge[c.type] ?? 'bg-slate-100 text-slate-600'}`}>{c.type}</span>
              </div>
            ))}
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => onConfirmDraft?.(d)} disabled={d.busy || dr.columns.length === 0}
            className="bg-[#E8913A] text-white text-sm font-semibold px-5 py-2 rounded-lg hover:brightness-95 disabled:opacity-50">
            {d.busy ? 'Creating…' : `Create template${dr.client_name ? ` for ${dr.client_name}` : ''}`}
          </button>
          <button onClick={() => onCancel?.()} className="text-sm font-semibold text-slate-500 px-4 py-2 rounded-lg hover:bg-slate-100">Cancel</button>
        </div>
      </div>
    )
  }

  if (d.type === 'insight') {
    const chipCls = c => /impact/i.test(c) ? 'bg-red-50 text-red-800' : /readiness/i.test(c) ? 'bg-indigo-50 text-indigo-700' : /overdue/i.test(c) ? 'bg-amber-50 text-amber-700' : 'bg-slate-100 text-slate-500'
    return (
      <div>
        {d.lead && <p className="text-[14px] leading-relaxed text-slate-700 mb-4"><Bold text={d.lead} /></p>}
        <div className="space-y-3">
          {(d.areas ?? []).map(a => (
            <div key={a.rank} className={`border rounded-xl px-4 py-3.5 ${a.rank === 1 ? 'border-l-[3px] border-l-red-400 bg-red-50/40 border-slate-100' : 'border-l-[3px] border-l-[#E8913A] border-slate-100'}`}>
              <div className="flex items-center gap-2.5 mb-1.5 flex-wrap">
                <span className="w-5 h-5 rounded-full bg-[#1F4E79] text-white text-[11px] font-bold flex items-center justify-center shrink-0">{a.rank}</span>
                <span className="font-bold text-slate-800 text-[14px]">{a.name}</span>
                <div className="flex flex-wrap gap-1.5 sm:ml-auto">
                  {(a.chips ?? []).map((c, i) => <span key={i} className={`text-[10.5px] font-semibold px-2 py-0.5 rounded-full ${chipCls(c)}`}>{c}</span>)}
                </div>
              </div>
              <p className="text-[13px] leading-relaxed text-slate-600"><Bold text={a.body} /></p>
              {a.evidence && <p className="text-[11px] text-slate-400 mt-2 pt-2 border-t border-dashed border-slate-200"><span className="font-semibold text-slate-500">Evidence:</span> {a.evidence}</p>}
            </div>
          ))}
        </div>
        {d.move && (
          <div className="mt-4 rounded-xl bg-[#1F4E79]/5 border border-[#1F4E79]/15 px-4 py-3.5">
            <p className="text-[13px] leading-relaxed text-slate-600"><span className="font-bold text-[#1F4E79]">The one move: </span><Bold text={d.move} /></p>
          </div>
        )}
      </div>
    )
  }

  if (d.type === 'heatmap') {
    if (!d.rows?.length) return <p className="text-sm text-slate-400">No heat map data.</p>
    const LV = { vh: '#991B1B', h: '#DC2626', m: '#E8913A', l: '#16A34A', vl: '#86EFAC', none: '#E2E8F0' }
    const NAME = { vh: 'Very High', h: 'High', m: 'Medium', l: 'Low', vl: 'Very Low', none: 'None' }
    return (
      <div>
        {(d.version || d.source) && <p className="text-[11px] text-slate-400 mb-2">✦ {d.version ? `v${d.version} · current` : ''}{d.source ? ` · from ${d.source}` : ''}</p>}
        <div className="overflow-x-auto">
          <table className="border-separate" style={{ borderSpacing: '6px' }}>
            <thead>
              <tr><th></th>{d.cols.map(c => <th key={c} className="text-[11px] font-semibold text-slate-500 px-1 text-center whitespace-nowrap">{c}</th>)}</tr>
            </thead>
            <tbody>
              {d.rows.map((r, i) => (
                <tr key={i}>
                  <td className="text-[12px] font-semibold text-slate-700 pr-2 text-right whitespace-nowrap">{r.label}</td>
                  {r.cells.map((lv, j) => (
                    <td key={j} className="text-center">
                      <span title={NAME[lv] ?? lv} className="inline-block w-[18px] h-[18px] rounded-full align-middle" style={{ background: LV[lv] ?? LV.none, boxShadow: '0 1px 3px rgba(0,0,0,.18)' }} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="flex flex-wrap gap-2.5 mt-3 text-[10.5px] text-slate-400">
          {['vh', 'h', 'm', 'l', 'vl', 'none'].map(k => <span key={k} className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full" style={{ background: LV[k] }} />{NAME[k]}</span>)}
        </div>
        {(d.headline || d.insights?.length) && (
          <div className="mt-4 rounded-xl bg-slate-50 border border-slate-200 border-l-[3px] border-l-[#1F4E79] px-4 py-3.5">
            <p className="text-[10px] font-bold text-[#E8913A] uppercase tracking-widest mb-2">✦ AI insight</p>
            {d.headline && <p className="text-[13.5px] leading-relaxed text-slate-600 mb-2.5"><Bold text={d.headline} /></p>}
            {d.insights?.length > 0 && (
              <ul className="space-y-1.5 text-[13px] leading-relaxed text-slate-600 list-disc pl-4 marker:text-slate-300">
                {d.insights.map((s, i) => <li key={i}><Bold text={s} /></li>)}
              </ul>
            )}
          </div>
        )}
      </div>
    )
  }

  if (d.type === 'projectTimeline') {
    if (!d.projects?.length) return <p className="text-sm text-slate-400">No project timeline available.</p>
    return (
      <div className="space-y-8">
        {d.projects.map(p => <ProjectTimeline key={p.id} project={p} readOnly />)}
      </div>
    )
  }

  if (d.type === 'list') {
    if (!d.rows?.length) return <p className="text-sm text-slate-400">{d.empty}</p>
    return (
      <div className="space-y-2">
        {d.rows.map((r, i) => {
          const onClick = rowHandler(r)
          const Tag = onClick ? 'button' : 'div'
          return (
            <Tag key={i} onClick={onClick ?? undefined}
              className={`w-full text-left flex items-center gap-3 border border-slate-200 rounded-xl px-3 py-2.5 ${onClick ? 'cursor-pointer hover:border-[#1F4E79] hover:bg-slate-50 transition-colors' : ''}`}>
              <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${r.rag === 'r' ? 'bg-red-500' : r.rag === 'a' ? 'bg-amber-500' : 'bg-green-500'}`} />
              <div className="min-w-0">
                <p className="font-semibold text-sm text-slate-800 truncate">{r.name}</p>
                <p className="text-xs text-slate-400 truncate">{r.meta}</p>
              </div>
              {r.due && <span className="ml-auto text-xs text-slate-400 shrink-0">{r.due}</span>}
              {onClick && <span className={`text-slate-300 ${r.due ? '' : 'ml-auto'}`}>›</span>}
            </Tag>
          )
        })}
      </div>
    )
  }

  if (d.type === 'progress') {
    if (!d.rows?.length) return <p className="text-sm text-slate-400">{d.empty}</p>
    return (
      <div className="space-y-1.5">
        {d.rows.map((r, i) => {
          const c = r.value >= 75 ? '#16A34A' : r.value >= 55 ? '#D97706' : '#DC2626'
          const onClick = rowHandler(r)
          const Tag = onClick ? 'button' : 'div'
          return (
            <Tag key={i} onClick={onClick ?? undefined}
              className={`w-full text-left flex items-center gap-3 rounded-lg px-2 py-1.5 ${onClick ? 'cursor-pointer hover:bg-slate-50 transition-colors' : ''}`}>
              <div className="w-32 shrink-0 min-w-0">
                <p className="text-[13px] font-semibold text-slate-700 truncate flex items-center gap-1.5">
                  {r.rag && <span className="w-2 h-2 rounded-full shrink-0" style={{ background: RAG_DOT[r.rag] }} />}
                  <span className="truncate">{r.label}</span>
                </p>
                {r.sub && <p className="text-[10px] text-slate-400 truncate">{r.sub}</p>}
              </div>
              <div className="flex-1 h-3 bg-slate-100 rounded-full overflow-hidden">
                <div className="h-full rounded-full" style={{ width: `${r.value}%`, background: c }} />
              </div>
              <span className="w-11 text-right text-[13px] font-bold" style={{ color: c }}>{r.value}%</span>
              {onClick && <span className="text-slate-300">›</span>}
            </Tag>
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
// `initialQueries` (optional): grounded questions auto-run on entry so the AI view opens as a
// briefing (e.g. Needs attention + Upcoming) instead of an empty canvas.
export default function AiCanvas({ fill = false, context = 'Ask anything about your programme — grounded in your data', showChips = true, chips = null, initialQueries = null }) {
  const { user, profile } = useAuth()
  const navigate = useNavigate()
  const ctx = useMemo(() => ({ userId: user?.id ?? null, clientId: profile?.client_id ?? null }), [user, profile])

  const [summary, setSummary] = useState(null)
  const [chipsOpen, setChipsOpen] = useState(true)
  const [dockOpen, setDockOpen] = useState(false)   // start as the compact floating pill
  const [widgets, setWidgets] = useState([])
  const [thinking, setThinking] = useState(false)
  const [progress, setProgress] = useState(null)
  const [input, setInput] = useState('')
  const [pendingFollowup, setPendingFollowup] = useState(null)   // e.g. 'report' — the last card asked a question
  const lastMiss = useRef(null)   // last query that fell through to SLM/external — for silent self-correction
  const [entityNames, setEntityNames] = useState([])   // known client/project/person names, longest-first
  const lastEntity = useRef(null)   // the entity the conversation is currently about
  const history = useRef([])        // recent [{ q, a }] turns for conversational memory
  const [attachedFile, setAttachedFile] = useState(null)   // admin: template file to turn into a workbook
  const canvasRef = useRef(null)
  const fileInputRef = useRef(null)
  const isAdminish = !!(profile?.is_admin || profile?.is_client_admin)

  useEffect(() => { loadSummary().then(setSummary).catch(() => setSummary(null)) }, [])

  // Known entity names so the conversation can carry context ("and the timeline?" → last client).
  useEffect(() => {
    (async () => {
      const [{ data: cl }, { data: pr }, { data: pf }] = await Promise.all([
        supabase.from('clients').select('name'),
        supabase.from('projects').select('name'),
        supabase.from('profiles').select('full_name'),
      ])
      const names = [...(cl ?? []).map(x => x.name), ...(pr ?? []).map(x => x.name), ...(pf ?? []).map(x => x.full_name)]
        .filter(n => n && n.length >= 3).sort((a, b) => b.length - a.length)
      setEntityNames(names)
    })().catch(() => {})
  }, [])

  // Briefing: auto-run the initial queries once, appended in order so the AI view opens populated.
  useEffect(() => {
    if (!initialQueries?.length) return
    let cancelled = false
    ;(async () => {
      for (const q of initialQueries) {
        try {
          const d = await ask(q, ctx)
          if (!cancelled) setWidgets(w => [...w, { ...d, query: q, key: `${q}-${Date.now()}` }])
        } catch { /* skip a failed briefing card */ }
      }
    })()
    return () => { cancelled = true }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function run(rawQ) {
    if (!rawQ?.trim() || thinking) return
    const label = rawQ.trim()
    // Continuity: if the previous card asked a follow-up (e.g. the report asked "Which client?"),
    // treat a bare reply as its answer instead of a brand-new query.
    let q = label
    const otherIntent = /\b(risk|readiness|progress|heat ?map|timeline|milestone|behind|upcoming|people|survey)\b/i.test(label)
    if (pendingFollowup === 'report' && !/\breport\b/i.test(label) && !otherIntent) {
      q = `build the change report for ${label}`
    }
    // Conversational memory: track the entity in play, and carry it into terse follow-ups so the
    // user doesn't repeat the name ("and the timeline?" → the client we were just discussing).
    const lower = label.toLowerCase()
    const mentioned = entityNames.find(n => lower.includes(n.toLowerCase()))
    if (mentioned) lastEntity.current = mentioned
    const isFollowup = /^(why|how|what about|and\b|so\b|then\b|explain|tell me more|more\b|expand|elaborate|details?|what else|go on|continue|the next|next\b)/i.test(label) || label.split(/\s+/).length <= 4
    if (!mentioned && lastEntity.current && isFollowup && q === label) q = `${label} (regarding ${lastEntity.current})`

    const rewritten = q !== label
    setPendingFollowup(null)
    setThinking(true); setProgress(null)
    try {
      const d = await ask(q, { ...ctx, history: history.current.slice(-6), entity: lastEntity.current }, { onProgress: p => setProgress(p?.text ?? null) })
      // Remember this turn (question + a short text of the answer) for context.
      const aText = d.body || d.headline || d.commentary || d.lead || d.title || ''
      history.current = [...history.current, { q: label, a: String(aText).replace(/\*\*/g, '').slice(0, 400) }].slice(-8)
      if (d.followup) setPendingFollowup(d.followup)   // this card is itself asking a question
      // Silent self-correction: a genuine (non-continuity) rules answer right after a miss on the
      // same topic teaches the framework that the missed phrasing meant this intent.
      const LEARNABLE = ['report', 'at_risk', 'readiness', 'progress', 'heatmap', 'milestones', 'upcoming', 'people', 'clients']
      if (d.tier === 'rules' && LEARNABLE.includes(d.intent)) {
        if (!rewritten && lastMiss.current && lastMiss.current !== label) {
          noteCorrection(lastMiss.current, label, d.intent, ctx.userId)   // fire-and-forget
        }
        lastMiss.current = null
      } else if (d.tier === 'slm' || d.tier === 'external') {
        lastMiss.current = label
      } else {
        lastMiss.current = null   // detail / other — avoid cross-topic mis-learning
      }
      // De-dupe: replace any existing card with the same title, moved fresh to the top.
      setWidgets(w => [{ ...d, query: label, key: Date.now() }, ...w.filter(x => x.title !== d.title)])
    } catch {
      setWidgets(w => [{ type: 'narrative', title: 'Something went wrong', body: 'That query could not be answered. Please try again.', query: q, key: Date.now() }, ...w])
    } finally {
      setThinking(false); setProgress(null)
      if (canvasRef.current) canvasRef.current.scrollTop = 0
    }
  }

  function submit(e) {
    e?.preventDefault()
    if (attachedFile) { handleTemplateFile(); return }
    const q = input.trim(); if (q) { run(q); setInput('') }
  }

  // Admin flow: parse the attached file + prompt into a DRAFT template (nothing written yet).
  async function handleTemplateFile() {
    const file = attachedFile, prompt = input.trim()
    setAttachedFile(null); setInput(''); if (fileInputRef.current) fileInputRef.current.value = ''
    setThinking(true); setProgress('Reading your template file…')
    try {
      const draft = await buildTemplateDraft(file, prompt)
      setWidgets(w => [{ type: 'templateDraft', title: 'Template draft — review before creating', query: prompt || `Attached: ${file.name}`, draft, key: `draft-${Date.now()}` }, ...w])
    } catch {
      setWidgets(w => [{ type: 'narrative', title: 'Could not read that file', body: 'Please attach an **.xlsx**, **.xls** or **.csv** with a header row of column names.', key: Date.now() }, ...w])
    } finally { setThinking(false); setProgress(null) }
  }

  // Guarded write — only after the admin clicks Confirm on the draft card.
  async function confirmDraft(d) {
    setWidgets(w => w.map(x => x.key === d.key ? { ...x, busy: true } : x))
    const err = await createTemplate(d.draft)
    setWidgets(w => w.map(x => x.key === d.key ? (err
      ? { ...x, type: 'narrative', title: 'Could not create template', body: err.message, busy: false }
      : { ...x, type: 'narrative', title: '✓ Template created', body: `**${d.draft.title}** added${d.draft.client_name ? ` for **${d.draft.client_name}**` : ' (global)'} — Phase ${d.draft.phase_number}, ${d.draft.columns.length} column${d.draft.columns.length === 1 ? '' : 's'}. It's now available to that client's members.`, busy: false }
    ) : x))
  }

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
      <style>{`
        @keyframes fadeIn{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}
        @media print{
          *{-webkit-print-color-adjust:exact !important;print-color-adjust:exact !important}
          html,body{background:#fff !important}
          .cf-hide-print{display:none !important}
          .cf-print-ancestor{display:block !important;position:static !important;overflow:visible !important;height:auto !important;min-height:0 !important;max-height:none !important;margin:0 !important;padding:0 !important;background:#fff !important;border:0 !important;border-radius:0 !important;box-shadow:none !important}
          .cf-print{padding:14mm 13mm !important;background:#fff !important}
          .cf-no-print{display:none !important}
          /* Keep a section together, and never leave a heading stranded at the foot of a page. */
          .cf-print section{break-inside:avoid !important;page-break-inside:avoid !important}
          .cf-print h1,.cf-print h2,.cf-print h3{break-after:avoid !important;page-break-after:avoid !important}
          .cf-print table,.cf-print tr,.cf-print li{break-inside:avoid !important;page-break-inside:avoid !important}
          @page{margin:0}
        }
      `}</style>

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
            <p className="text-lg font-bold text-slate-700">Ask CORA</p>
            <p className="max-w-md text-sm leading-relaxed"><span className="font-semibold text-slate-500">CORA — Change Orchestration &amp; Readiness Assistant.</span> Answers are grounded in your real, role-scoped data. Tap a chip above or a suggestion below to begin.</p>
          </div>
        ) : (
          widgets.map(w => <Widget key={w.key} d={w} onDrill={run} onNavigate={navigate} onConfirmDraft={confirmDraft} canAct={!!profile?.is_admin} onRemove={() => setWidgets(list => list.filter(x => x.key !== w.key))} />)
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
          <div className="pt-2 max-w-4xl mx-auto px-2">
            <div className="flex gap-2 overflow-x-auto pb-2.5">
              {SUGGESTIONS.map(s => (
                <button key={s.q} onClick={() => run(s.q)} disabled={thinking}
                  className="shrink-0 border border-slate-200 rounded-full px-3.5 py-2 text-[13px] text-[#1F4E79] hover:bg-slate-50 disabled:opacity-50 whitespace-nowrap">
                  {s.label}
                </button>
              ))}
            </div>
            {attachedFile && (
              <div className="flex items-center gap-2 mb-2 text-xs">
                <span className="inline-flex items-center gap-1.5 bg-[#FDECD8] text-[#B45309] border border-amber-200 rounded-full px-3 py-1 font-semibold">
                  📎 {attachedFile.name}
                  <button onClick={() => { setAttachedFile(null); if (fileInputRef.current) fileInputRef.current.value = '' }} className="text-amber-500 hover:text-amber-700">✕</button>
                </span>
                <span className="text-slate-400">Add the customer's name &amp; phase, then send to draft a template.</span>
              </div>
            )}
            <form onSubmit={submit} className="flex items-center gap-2.5 border-[1.5px] border-[#E8913A] rounded-2xl px-4 py-2.5" style={{ boxShadow: '0 0 0 3px rgba(232,145,58,.12)' }}>
              <span className="w-2.5 h-2.5 rounded-full bg-[#E8913A] shrink-0" />
              {isAdminish && (
                <>
                  <input ref={fileInputRef} type="file" accept=".xlsx,.xls,.csv" className="hidden"
                    onChange={e => setAttachedFile(e.target.files?.[0] ?? null)} />
                  <button type="button" onClick={() => fileInputRef.current?.click()} disabled={thinking}
                    title="Attach a template file (Excel/CSV) to create a workbook"
                    className="text-slate-400 hover:text-[#E8913A] shrink-0 disabled:opacity-50">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>
                  </button>
                </>
              )}
              <input value={input} onChange={e => setInput(e.target.value)} disabled={thinking}
                placeholder={attachedFile ? 'e.g. add this template for Horizon Power, phase 2' : 'Ask CORA — risks, readiness, progress, timelines…'}
                className="flex-1 outline-none text-[15px] text-slate-800 placeholder:text-slate-400 disabled:opacity-60" />
              <button type="submit" disabled={thinking || (!input.trim() && !attachedFile)}
                className="bg-[#E8913A] text-white rounded-xl w-9 h-8 font-bold disabled:opacity-50 hover:brightness-95">↑</button>
            </form>
            <p className="text-center text-[10px] text-slate-300 tracking-widest mt-2 font-mono">
              CORA · GROUNDED &amp; ROLE-SCOPED{slmOptedIn() ? ' · ON-DEVICE SLM ON' : ''}
            </p>
          </div>
        </div>
      ) : (
        <div className="shrink-0 flex justify-center py-4 bg-slate-50">
          <button onClick={() => setDockOpen(true)} title="Ask CORA"
            className="flex items-center gap-3 bg-white border border-slate-200 rounded-full pl-4 pr-2 py-2 shadow-md hover:shadow-lg transition-shadow">
            <span className="w-2.5 h-2.5 rounded-full bg-[#E8913A] shrink-0" />
            <span className="text-[15px] text-slate-400 pr-1">Ask CORA…</span>
            <span className="w-8 h-8 rounded-full bg-[#FDECD8] flex items-center justify-center text-[#E8913A] font-bold text-sm shrink-0">✦</span>
          </button>
        </div>
      )}
    </div>
  )
}
