// ChangeFlow · pure analysis helpers (no Supabase, no side effects) — unit-testable.
// Home for the report gantt builder, the Integrated Insight ranker, and the phrase-learning
// tokeniser. rules.js imports these; tests import them directly.

export const LV_W = { vh: 5, h: 4, m: 3, l: 2, vl: 1, none: 0 }
export const LV_LABEL = { vh: 'Very High', h: 'High', m: 'Medium', l: 'Low', vl: 'Very Low', none: 'None' }

// Build an export-ready gantt (month-bucketed) from the report's already-loaded projects.
// Bars = ChangeFlow phases (coloured by schedule/completion); points = delivery milestones.
export function buildReportGantt(cp) {
  const dates = []
  cp.forEach(p => {
    p.phases.forEach(ph => { if (ph.planned_start) dates.push(ph.planned_start); if (ph.planned_end) dates.push(ph.planned_end) })
    ;(p.milestones || []).forEach(m => { if (m.milestone_date) dates.push(m.milestone_date) })
  })
  if (!dates.length) return null
  const ds = dates.map(s => new Date(s + 'T00:00:00'))
  const min = new Date(Math.min(...ds)), max = new Date(Math.max(...ds))
  const y0 = min.getFullYear(), m0 = min.getMonth()
  const nMonths = (max.getFullYear() - y0) * 12 + (max.getMonth() - m0) + 1
  const months = []
  for (let i = 0; i < nMonths; i++) {
    const d = new Date(y0, m0 + i, 1)
    months.push(d.toLocaleDateString(undefined, { month: 'short' }) + (d.getMonth() === 0 ? ` ’${String(d.getFullYear()).slice(2)}` : ''))
  }
  const idx = s => { const d = new Date(s + 'T00:00:00'); return (d.getFullYear() - y0) * 12 + (d.getMonth() - m0) }
  const today = new Date()
  const projects = cp.map(p => {
    const rows = []
    p.phases.forEach(ph => {
      if (!ph.planned_start && !ph.planned_end) return
      const s = ph.planned_start || ph.planned_end, e = ph.planned_end || ph.planned_start
      const startD = new Date(s + 'T00:00:00'), endD = new Date(e + 'T00:00:00')
      const status = (ph.pct ?? 0) >= 100 ? 'completed' : (today >= startD || today > endD) ? 'active' : 'locked'
      rows.push({ kind: 'bar', label: `0${ph.phase_number} ${ph.name}`, startIdx: idx(s), endIdx: idx(e), pct: ph.pct ?? 0, status })
    })
    ;(p.milestones || []).filter(m => m.milestone_date).forEach(m => rows.push({ kind: 'point', label: m.name, pointIdx: idx(m.milestone_date), color: m.color || null }))
    return { name: p.name, rows }
  }).filter(p => p.rows.length)
  if (!projects.length) return null
  const todayIdx = today >= min && today <= max ? (today.getFullYear() - y0) * 12 + (today.getMonth() - m0) : null
  return { months, projects, todayIdx }
}

// Integrated insight: correlate the heat map (per-group impact) with programme progress, risk,
// readiness and upcoming milestones into a ranked list of focus areas.
export function buildIntegratedInsight(heat, { pct, atRisk, avg, ragWord, upcoming }) {
  if (!heat?.rows?.length) return null
  const cols = heat.cols || []
  const scored = heat.rows.map(r => {
    const cells = r.cells || []
    const total = cells.reduce((s, lv) => s + (LV_W[lv] || 0), 0)
    let domIdx = 0, domW = -1, maxLv = 'none'
    cells.forEach((lv, i) => { const w = LV_W[lv] || 0; if (w > domW) { domW = w; domIdx = i } if (w > (LV_W[maxLv] || 0)) maxLv = lv })
    return { name: r.label, total, maxLv, dom: cols[domIdx] || 'impact', highCount: cells.filter(lv => lv === 'vh' || lv === 'h').length }
  }).sort((a, b) => b.total - a.total)

  const readinessUnknown = avg == null
  const top = scored.slice(0, 3)
  const areas = top.map((g, i) => {
    const chips = [`Impact ${LV_LABEL[g.maxLv]}`]
    if (i === 0) chips.push(atRisk.length ? `${atRisk.length} phase${atRisk.length === 1 ? '' : 's'} overdue` : `${pct}% complete`)
    if (readinessUnknown && i < 2) chips.push('Readiness —')
    let body
    if (i === 0) body = `**${g.name}** peaks ${LV_LABEL[g.maxLv]} (strongest on ${g.dom}) with ${g.highCount} high-impact domain${g.highCount === 1 ? '' : 's'} — the pivot of this change. ${readinessUnknown ? 'With no readiness data yet, run the phase survey here first and stand up its change champions.' : `Readiness is ${ragWord}; concentrate engagement and comms here.`}`
    else if (i === 1) body = `**${g.name}** is broadly exposed (${g.highCount} high-impact domain${g.highCount === 1 ? '' : 's'}, strongest on ${g.dom}). Sequence engagement right after ${top[0].name}${upcoming.length ? `, using "${upcoming[0].name}" (${upcoming[0].due}) as the forcing point` : ''}.`
    else body = g.total <= 4 ? `**${g.name}** — lightest touch; keep informed and redirect capacity to the groups above.` : `**${g.name}** — moderate impact (strongest on ${g.dom}); monitor and support as the programme moves.`
    const evidence = `heat map${heat.version ? ` v${heat.version}` : ''} (${g.name} row)` +
      (i === 0 ? ` · snapshot (${pct}%)${readinessUnknown ? ' · readiness (0 responses)' : ''}` : (i === 1 && upcoming.length ? ` · upcoming "${upcoming[0].name}"` : ''))
    return { rank: i + 1, name: g.name, level: g.maxLv, chips, body, evidence }
  })

  const lead = `Independent signals converge on the same place. The **stakeholder heat map** flags **${top.slice(0, 2).map(g => g.name).join('** and **')}** as the highest-impact groups; **delivery** is at **${pct}%**${atRisk.length ? ` with ${atRisk.length} phase${atRisk.length === 1 ? '' : 's'} overdue` : ''}; and **readiness** is **${readinessUnknown ? 'unmeasured' : ragWord}**. Where impact is high and progress or readiness is weak is where the programme is most exposed — effort there de-risks the most.`
  const move = readinessUnknown
    ? `Get the phase readiness survey out to ${top.slice(0, 2).map(g => g.name).join(' and ')} this week — it's the missing signal on your highest-risk groups.`
    : atRisk.length
    ? `Clear the ${atRisk.length} overdue phase${atRisk.length === 1 ? '' : 's'} concentrated around ${top[0].name} — they gate go-live.`
    : `Focus engagement on ${top[0].name} first — highest impact and the greatest point of leverage right now.`

  return { heading: 'Where to focus', type: 'insight', lead, areas, move }
}

// ── Scope resolution (auto-scoping to the conversation's client/project) ──────────
// Pure: given the query text, the conversation ctx (with a remembered `entity`) and the loaded
// data (projRollup + clients), work out whether the answer should narrow to one project or client.
// An explicitly named entity in the text wins; otherwise fall back to the remembered entity.
export function resolveScope(text, ctx, data) {
  const t = (text ?? '').toLowerCase()
  const named = s => s && s.length >= 3 && t.includes(s.toLowerCase())
  let proj = data.projRollup.find(p => named(p.name)) || null
  let client = proj ? null : (data.clients.find(c => named(c.name)) || null)
  if (!proj && !client && ctx?.entity) {
    const e = String(ctx.entity).toLowerCase()
    proj = data.projRollup.find(p => p.name && e.includes(p.name.toLowerCase())) || null
    if (!proj) client = data.clients.find(c => c.name && e.includes(c.name.toLowerCase())) || null
  }
  return { proj, client, label: proj ? proj.name : client ? client.name : null, suffix: (proj || client) ? ` · ${proj ? proj.name : client.name}` : '' }
}

// Narrow the project rollup to the resolved scope (one project, one client's projects, or all).
export function scopedProjects(data, scope) {
  if (scope.proj) return data.projRollup.filter(p => p.id === scope.proj.id)
  if (scope.client) return data.projRollup.filter(p => p.client_id === scope.client.id)
  return data.projRollup
}

// ── Phase drill (activities · owners · per-activity progress) ─────────────────────
// Pure: build the phase-drill widget from already-fetched rows. rules.js does the Supabase
// reads (pathway → content → completions) and hands the arrays here so the logic is testable.
export function buildPhaseDrill({ projectName, phaseName, orderedContentIds, content, completions, memberIds, profiles }) {
  const ids = orderedContentIds || []
  const nameOf = id => (profiles || []).find(u => u.id === id)?.full_name ?? 'Someone'
  const rows = ids.map(cid => {
    const c = (content || []).find(x => x.id === cid)
    const doneIds = (completions || []).filter(a => a.content_id === cid).map(a => a.user_id)
    const pct = memberIds.length ? Math.round((doneIds.length / memberIds.length) * 100) : 0
    const doneNames = doneIds.map(nameOf)
    const sub = `${c?.content_type ?? 'activity'} · ${doneIds.length}/${memberIds.length} done${doneNames.length ? ` · ${doneNames.join(', ')}` : ' · not started'}`
    return { label: c?.title ?? 'Activity', sub, value: pct }
  })
  const owners = memberIds.map(nameOf)
  const fullyDone = rows.filter(r => r.value >= 100).length
  const n = ids.length
  const intro =
    `**${phaseName}** in **${projectName}** has **${n}** activit${n === 1 ? 'y' : 'ies'} for the team to work through` +
    (owners.length ? `, owned by **${owners.join('** and **')}**` : ' (no members assigned yet)') + '. ' +
    `**${fullyDone}/${n}** ${fullyDone === 1 ? 'is' : 'are'} fully complete across the team so far.\n\nHere's each activity, its owners and progress:`
  return { type: 'progress', title: `${projectName} · ${phaseName}`, rows, empty: `No activities in ${phaseName} yet.`, intro }
}

// ── Usage attribution (telemetry: which client / project a query was about) ───────
// Pure: attribute an AI query to a client and/or project for the System Admin usage breakdown.
// Prefers a project named in the query text, else in the conversation's remembered entity; infers
// the client from that project. If no project matches, matches a client by name. Longest name
// wins so multi-word names beat their substrings. Returns ids (or null) — never throws.
export function resolveUsageScope(text, entity, clients = [], projects = []) {
  const hay = `${text ?? ''}   ${entity ?? ''}`.toLowerCase()
  const byLen = arr => [...(arr || [])].filter(x => x && x.name && x.name.length >= 3).sort((a, b) => b.name.length - a.name.length)
  const proj = byLen(projects).find(p => hay.includes(p.name.toLowerCase())) || null
  let clientId = proj ? (proj.client_id ?? null) : null
  if (!clientId) clientId = (byLen(clients).find(c => hay.includes(c.name.toLowerCase())) || null)?.id ?? null
  return { clientId: clientId ?? null, projectId: proj?.id ?? null }
}

// ── Grounded fallback (no model tier available) ───────────────────────────────────
// Pure: when neither the on-device SLM nor an external model is available, turn the already-
// assembled grounded context into a useful, deterministic answer instead of a "not configured"
// message. Picks the context lines most relevant to the question by keyword overlap. Never
// invents — it only surfaces lines that are already in the grounded snapshot.
export function groundedFallback(question, grounding) {
  if (!grounding || !String(grounding).trim()) return null
  const lines = String(grounding).split('\n').map(l => l.replace(/\s+$/, '')).filter(l => l.trim())
  if (!lines.length) return null
  const header = lines[0]                          // "Client: … (as of …)"
  const rest = lines.slice(1)
  const qToks = distinctiveTokens(question)
  const scored = rest.map((l, i) => {
    const lt = l.toLowerCase()
    return { l, i, score: qToks.reduce((s, tk) => s + (lt.includes(tk) ? 1 : 0), 0) }
  })
  const hits = scored.filter(s => s.score > 0).sort((a, b) => b.score - a.score || a.i - b.i)
  const picked = (hits.length ? hits : scored).slice(0, 8).sort((a, b) => a.i - b.i).map(s => s.l.trim())
  const lead = hits.length
    ? `I don't have a model tier configured for open-ended reasoning, but here's what your data shows on that:`
    : `I don't have a model tier configured for open-ended reasoning. Here's the grounded snapshot — ask me a specific data question (progress, at-risk, milestones, readiness, heat map) for more:`
  return `${lead}\n\n_${header}_\n\n${picked.map(l => (l.startsWith('•') ? l : `- ${l}`)).join('\n')}`
}

// ── Phrase learning tokeniser ────────────────────────────────────────────────────
export const LEARN_STOP = new Set(('show give me the for a an of to please can you get on in with and or my our your ' +
  'this that is are it as by from at build create generate make change report a1 s').split(' '))
export const normPhrase = s => String(s ?? '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim()
export function distinctiveTokens(text, entityNames = []) {
  let s = ` ${normPhrase(text)} `
  entityNames.forEach(n => { const nn = normPhrase(n); if (nn.length >= 3) s = s.split(nn).join(' ') })
  return [...new Set(s.split(/\s+/).filter(w => w.length >= 3 && !LEARN_STOP.has(w)))]
}
