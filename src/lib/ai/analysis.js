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
  // Two projects can share a name across clients. Picking the first silently answers
  // about the wrong one, so an exact match that hits more than one is ambiguous.
  const projHits = (data.projRollup ?? []).filter(p => named(p.name))
  const clientHits = projHits.length ? [] : (data.clients ?? []).filter(c => named(c.name))
  let proj = projHits.length === 1 ? projHits[0] : null
  let client = clientHits.length === 1 ? clientHits[0] : null
  let nameClash = (projHits.length > 1 && [...projHits]) || (clientHits.length > 1 && [...clientHits]) || null

  // Full-name match failed. People say "Meridian", not the registered legal name, so
  // fall back to matching on the parts of a name that only one candidate has.
  let ambiguous = nameClash
  if (!proj && !client && !ambiguous) {
    const ph = matchByPartialName(text, data.projRollup ?? [])
    if (ph?.entity) proj = ph.entity
    else {
      const ch = matchByPartialName(text, data.clients ?? [])
      if (ch?.entity) client = ch.entity
      else ambiguous = ph?.ambiguous ?? ch?.ambiguous ?? null
    }
  }
  if (!proj && !client && ctx?.entity) {
    const e = String(ctx.entity).toLowerCase()
    proj = data.projRollup.find(p => p.name && e.includes(p.name.toLowerCase())) || null
    if (!proj) client = data.clients.find(c => c.name && e.includes(c.name.toLowerCase())) || null
  }
  // Nothing matched by name. Before falling back to "everything", check whether the
  // question contains a near miss for a real client or project — a typo should be
  // offered back, not silently answered as an org-wide question.
  let didYouMean = null
  if (!proj && !client) {
    const hit = fuzzyEntityMatch(text, [...(data.projRollup ?? []), ...(data.clients ?? [])])
    if (hit) {
      const isProj = (data.projRollup ?? []).some(p => p.id === hit.entity.id)
      didYouMean = { name: hit.entity.name, kind: isProj ? 'project' : 'client', typed: hit.typed, score: Number(hit.score.toFixed(2)) }
    }
  }

  return {
    proj, client,
    label: proj ? proj.name : client ? client.name : null,
    suffix: (proj || client) ? ` · ${proj ? proj.name : client.name}` : '',
    didYouMean, ambiguous,
  }
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

// ── Trend & velocity ──────────────────────────────────────────────────────────────
// Turns daily progress snapshots into the question sponsors actually ask: are we improving, and
// will we make the date? Pure — the caller supplies snapshots (ascending by date) and the planned
// end date. Deliberately conservative: with too little history or no movement it says so rather
// than extrapolating from noise.
export function computeTrend(snapshots = [], { plannedEnd = null, today = new Date() } = {}) {
  const pts = (snapshots || [])
    .filter(s => s && s.captured_on != null && s.pct != null)
    .map(s => ({ on: new Date(s.captured_on), pct: Number(s.pct) }))
    .sort((a, b) => a.on - b.on)
  if (!pts.length) return { status: 'none', points: [] }

  const now = new Date(today)
  const latest = pts[pts.length - 1]
  const daysBetween = (a, b) => (b.getTime() - a.getTime()) / 864e5
  // Closest snapshot at least N days old (so a gap in capture doesn't break the comparison).
  const at = days => {
    const cutoff = new Date(now.getTime() - days * 864e5)
    const older = pts.filter(p => p.on <= cutoff)
    return older.length ? older[older.length - 1] : null
  }
  const wk = at(7), mo = at(28), first = pts[0]

  const span = daysBetween(first.on, latest.on)
  if (pts.length < 2 || span < 1) {
    return { status: 'building', points: pts, current: latest.pct, days: Math.round(span) }
  }

  // Velocity from the longest reliable window we have (prefer 28d, else whatever exists).
  const base = mo ?? wk ?? first
  const days = Math.max(1, daysBetween(base.on, latest.on))
  const perWeek = ((latest.pct - base.pct) / days) * 7

  const remaining = Math.max(0, 100 - latest.pct)
  let forecast = null, weeksLeft = null
  if (perWeek > 0.1) {
    weeksLeft = remaining / perWeek
    forecast = new Date(now.getTime() + weeksLeft * 7 * 864e5)
  }

  let verdict = 'unknown'
  if (perWeek <= 0.1) verdict = latest.pct >= 100 ? 'complete' : 'stalled'
  else if (plannedEnd) {
    const due = new Date(plannedEnd)
    const slipDays = Math.round(daysBetween(due, forecast))
    verdict = slipDays <= 0 ? 'ahead' : slipDays <= 7 ? 'on_track' : 'behind'
    // Activity completion burns down fast in early phases and slowly in late ones, so a
    // straight-line projection routinely "finishes" months before the remaining phases
    // are even scheduled to start. That is arithmetic, not a forecast, and reporting it
    // as a date invites a decision on something that cannot happen. Flagged here — at
    // source — so every consumer (canvas, story, Word, PowerPoint) inherits the caveat
    // instead of each one re-deriving it and one of them forgetting.
    const forecastBeforePlan = forecast != null && forecast.getTime() < due.getTime()
    return {
      status: 'ok', points: pts, current: latest.pct,
      delta7: wk ? latest.pct - wk.pct : null,
      delta28: mo ? latest.pct - mo.pct : null,
      perWeek: Math.round(perWeek * 10) / 10,
      forecast, weeksLeft: Math.round(weeksLeft * 10) / 10, verdict, slipDays,
      forecastBeforePlan, plannedEnd,
    }
  } else verdict = 'moving'

  return {
    status: 'ok', points: pts, current: latest.pct,
    delta7: wk ? latest.pct - wk.pct : null,
    delta28: mo ? latest.pct - mo.pct : null,
    perWeek: Math.round(perWeek * 10) / 10,
    forecast, weeksLeft: weeksLeft == null ? null : Math.round(weeksLeft * 10) / 10,
    verdict, slipDays: null,
  }
}

// Geometry for the trend chart. Pure: returns SVG-ready coordinates so the component just draws.
// With too little history it still returns a usable chart — today's position plotted against the
// planned end date — and flags `sparse` so the UI can say so honestly rather than faking a line.
export const TREND_COLORS = ['#1F4E79', '#2f8fe0', '#E8913A', '#16A34A', '#7F77DD', '#D4537E']

export function buildTrendChart(seriesList = [], { plannedEnd = null, today = new Date(), w = 320, h = 120, pad = 22 } = {}) {
  // One line per programme. Averaging several programmes into a single line hides the one that is
  // actually moving behind the one that hasn't started, so each keeps its own series.
  const prepared = (seriesList || []).map((s, i) => ({
    name: s?.name ?? `Series ${i + 1}`,
    color: TREND_COLORS[i % TREND_COLORS.length],
    forecast: s?.forecast ?? null,
    pts: (s?.points || [])
      .filter(p => p && p.captured_on != null && p.pct != null)
      .map(p => ({ on: new Date(p.captured_on), pct: Math.max(0, Math.min(100, Number(p.pct))) }))
      .sort((a, b) => a.on - b.on),
  }))

  const now = new Date(today)
  const allPts = prepared.flatMap(s => s.pts)
  const sparse = !prepared.some(s => s.pts.length > 1)

  const first = allPts.length ? new Date(Math.min(...allPts.map(p => p.on.getTime()))) : now
  const ends = [now, plannedEnd ? new Date(plannedEnd) : null, ...prepared.map(s => s.forecast ? new Date(s.forecast) : null)].filter(Boolean)
  const fullLast = new Date(Math.max(...ends.map(d => d.getTime())))

  // A planned end far beyond the last snapshot squeezes every data point into the
  // left edge and leaves most of the chart empty — the line becomes unreadable to
  // protect a marker. Cap the axis at the data plus 35% headroom and pin anything
  // beyond it to the right edge, flagged so the renderer can show it as off-scale.
  const dataLast = allPts.length ? new Date(Math.max(...allPts.map(p => p.on.getTime()), now.getTime())) : now
  const dataSpan = Math.max(1, dataLast.getTime() - first.getTime())
  const cap = new Date(dataLast.getTime() + dataSpan * 0.35)
  const clamped = fullLast.getTime() > cap.getTime()
  const last = clamped ? cap : fullLast
  const span = Math.max(1, last.getTime() - first.getTime())

  // Anything past the capped axis pins to the right edge rather than running off it.
  const x = d => {
    const t = Math.min(new Date(d).getTime(), last.getTime())
    return Math.round((pad + ((t - first.getTime()) / span) * (w - pad * 2)) * 10) / 10
  }
  const y = pct => Math.round((h - pad - (pct / 100) * (h - pad * 2)) * 10) / 10

  const single = prepared.length === 1
  const series = prepared.map(s => {
    const coords = s.pts.map(p => ({ x: x(p.on), y: y(p.pct), pct: p.pct, on: p.on }))
    const line = coords.length > 1 ? coords.map((c, i) => `${i ? 'L' : 'M'}${c.x},${c.y}`).join(' ') : null
    const latest = coords[coords.length - 1] ?? null
    return {
      name: s.name, color: s.color, coords, line,
      area: (single && line) ? `${line} L${coords[coords.length - 1].x},${y(0)} L${coords[0].x},${y(0)} Z` : null,
      latest,
      current: s.pts.length ? s.pts[s.pts.length - 1].pct : 0,
      forecastLine: (s.forecast && latest) ? `M${latest.x},${latest.y} L${x(s.forecast)},${y(100)}` : null,
      forecastPt: s.forecast ? { x: x(s.forecast), y: y(100) } : null,
    }
  })

  return {
    w, h, pad, sparse, series, multi: prepared.length > 1,
    plannedX: plannedEnd ? x(plannedEnd) : null,
    // True when the planned end sits beyond the drawn axis, so its marker is at the
    // edge rather than at its real position — the label should say so.
    plannedOffScale: !!(plannedEnd && clamped && new Date(plannedEnd).getTime() > last.getTime()),
    todayX: x(now),
    baseY: y(0), topY: y(100), midY: y(50),
    firstLabel: first, lastLabel: last,
  }
}

// One-line summary of a trend, for the report narrative.
export function trendSentence(t, fmtDate = d => new Date(d).toLocaleDateString('en', { day: 'numeric', month: 'short', year: 'numeric' })) {
  if (!t || t.status === 'none') return 'No history captured yet — trend will appear once daily snapshots have accumulated.'
  if (t.status === 'building') return `Only ${t.days} day${t.days === 1 ? '' : 's'} of history so far (currently **${t.current}%**). Velocity needs about a week of snapshots before it means anything.`
  const move = t.delta7 != null ? `${t.delta7 >= 0 ? '+' : ''}${t.delta7}% in the last 7 days` : null
  const mo = t.delta28 != null ? `${t.delta28 >= 0 ? '+' : ''}${t.delta28}% over 28 days` : null
  const head = `Currently **${t.current}%**${move ? `, ${move}` : ''}${mo ? ` (${mo})` : ''}.`
  if (t.verdict === 'complete') return `${head} Delivery is complete.`
  if (t.verdict === 'stalled') return `${head} **Progress has stalled** — no measurable movement, so no completion can be forecast. This is the finding to act on.`
  const rate = `Averaging **${t.perWeek}% per week**`
  // Suppress the date when the projection lands before the plan still runs — say the
  // rate, and say why the date is meaningless, rather than quietly printing a fiction.
  if (t.forecastBeforePlan) {
    return `${head} ${rate}. At that rate the activity burn-down finishes early, but the plan still runs to **${fmtDate(t.plannedEnd)}** — the remaining phases are scheduled, not merely unstarted, so treat the rate as a health signal rather than a finish date.`
  }
  const eta = t.forecast ? `, which puts completion around **${fmtDate(t.forecast)}**` : ''
  if (t.verdict === 'ahead') return `${head} ${rate}${eta} — **ahead of the planned end date**.`
  if (t.verdict === 'on_track') return `${head} ${rate}${eta} — **on track** against the planned end date.`
  if (t.verdict === 'behind') return `${head} ${rate}${eta} — that is **${t.slipDays} days past the planned end date**. Either the plan or the pace needs to change.`
  return `${head} ${rate}${eta}.`
}

// ── Knowledge-rule routing ────────────────────────────────────────────────────────
// Which rule answers this question? Rules declare their own trigger phrases in the database, so a
// new subject is an INSERT rather than a code change. The longest matching trigger wins, so a
// specific rule ("train the trainer") beats a general one ("training").
export function matchKnowledgeRule(text, rules = []) {
  const t = (text ?? '').toLowerCase()
  let best = null, bestLen = 0
  for (const r of rules || []) {
    for (const trig of r?.triggers ?? []) {
      const term = String(trig).toLowerCase()
      if (term && t.includes(term) && term.length > bestLen) { best = r; bestLen = term.length }
    }
  }
  return best
}

// ── Knowledge-rule rendering ──────────────────────────────────────────────────────
// Guidance lives in the ai_knowledge table as templates with {{tokens}}; CORA fills them from the
// client's live picture. Pure so the substitution is unit-testable. Unknown tokens are replaced
// with a visible marker rather than left raw, so a bad template never leaks braces to the user.
export function renderTemplate(body, tokens = {}) {
  if (!body) return ''
  return String(body).replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_, key) => {
    const v = tokens[key]
    return v === undefined || v === null || v === '' ? '—' : String(v)
  })
}

// Which tokens does a template actually use? Lets the UI/tests see a rule's data dependencies.
export function templateTokens(body) {
  return [...new Set([...String(body ?? '').matchAll(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g)].map(m => m[1]))]
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

// ── Timeline swimlanes ────────────────────────────────────────────────────────
// Pale fills for lane bands. Deliberately separate from the saturated bar palette:
// a lane tinted as dark as a bar would swallow any bar drawn on top of it.
export const LANE_TINTS = [
  { tint: '#eff6ff', border: '#bfdbfe', text: '#1e40af', label: 'Blue' },
  { tint: '#f0fdfa', border: '#99f6e4', text: '#0f766e', label: 'Teal' },
  { tint: '#fef3c7', border: '#fde68a', text: '#92400e', label: 'Amber' },
  { tint: '#f0fdf4', border: '#bbf7d0', text: '#15803d', label: 'Green' },
  { tint: '#fef2f2', border: '#fecaca', text: '#b91c1c', label: 'Red' },
  { tint: '#faf5ff', border: '#e9d5ff', text: '#7e22ce', label: 'Violet' },
  { tint: '#fdf2f8', border: '#fbcfe8', text: '#be185d', label: 'Pink' },
  { tint: '#f8fafc', border: '#e2e8f0', text: '#475569', label: 'Slate' },
]

// The border and title colour are derived from the tint rather than stored, so a
// lane can never end up with a title that's invisible against its own background.
export function laneStyle(tint) {
  return LANE_TINTS.find(t => t.tint === tint) ?? LANE_TINTS[LANE_TINTS.length - 1]
}

// Flat lane rows -> one level of nesting. Anything pointing at a missing or
// already-nested parent is surfaced at top level rather than silently dropped.
export function buildLaneTree(lanes = []) {
  const tops = lanes.filter(l => !l.parent_id)
  const topIds = new Set(tops.map(l => l.id))
  const byOrder = (a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0)
  const orphans = lanes.filter(l => l.parent_id && !topIds.has(l.parent_id))
  return [...tops, ...orphans].sort(byOrder).map(l => ({
    ...l,
    children: lanes.filter(c => c.parent_id === l.id).sort(byOrder),
  }))
}

// A pct outside 0–100 would draw a fill wider than its bar, so it is clamped at
// the boundary rather than trusted from the row.
export const clampPct = v => Math.max(0, Math.min(100, Math.round(Number(v) || 0)))

// Milestones and dated activities share a row shape so the renderer and the drag
// machinery don't need to care which table a bar came from.
export function rowsForLane(laneId, milestones = [], activities = []) {
  const ms = milestones.filter(m => m.lane_id === laneId).map(m => ({
    id: m.id, table: 'project_milestones', name: m.name, color: m.color,
    starts_on: m.starts_on, ends_on: m.ends_on, milestone_date: m.milestone_date,
    sort_order: m.sort_order ?? 0, lane_id: laneId, pct: clampPct(m.pct),
  }))
  const acts = activities.filter(a => a.lane_id === laneId).map(a => ({
    id: a.id, table: 'project_pathways', name: a.name, color: a.color,
    starts_on: a.starts_on, ends_on: a.ends_on, milestone_date: null,
    sort_order: a.sort_order ?? 0, lane_id: laneId, activity: true, pct: clampPct(a.pct), derivedPct: true,
    undated: !a.starts_on || !a.ends_on,
  }))
  return [...ms, ...acts].sort((a, b) => (a.sort_order - b.sort_order) || a.name.localeCompare(b.name))
}

// Items sharing a sort_order share a line. That makes sort_order the row number
// rather than a strict ordinal, which is what lets a milestone sit on the same
// line as the band it belongs to (Go-Live on the end of Build, say).
export function groupLaneRows(rows = []) {
  const byRow = new Map()
  rows.forEach(r => {
    const k = r.sort_order ?? 0
    if (!byRow.has(k)) byRow.set(k, [])
    byRow.get(k).push(r)
  })
  return [...byRow.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([sort_order, items]) => ({
      sort_order,
      key: `row-${sort_order}`,
      items,
      // Bands first so a point marker paints on top of a band it overlaps.
      ordered: [...items].sort((a, b) => Number(!!b.ends_on) - Number(!!a.ends_on)),
      label: items.map(i => i.name).join(' · '),
    }))
}

// ── Fuzzy entity matching ─────────────────────────────────────────────────────
// "Merdian" should not silently widen the answer to every client. When an exact
// name match fails, look for a near miss and offer it back as a suggestion.

// Damerau-Levenshtein (optimal string alignment): counts a transposition as ONE
// edit, not two. Swapped adjacent letters are the most common typing mistake —
// "Horzion" for "Horizon" — and plain Levenshtein scores those far enough apart
// that a real near miss falls below any sensible threshold.
function levenshtein(a, b) {
  if (a === b) return 0
  if (!a.length) return b.length
  if (!b.length) return a.length
  const d = Array.from({ length: a.length + 1 }, (_, i) =>
    Array.from({ length: b.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)))
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost)
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1)
      }
    }
  }
  return d[a.length][b.length]
}

const simRatio = (a, b) => (a.length || b.length) ? 1 - levenshtein(a, b) / Math.max(a.length, b.length) : 1

// Compare each meaningful word in the question against each word of each candidate
// name, rather than whole strings — "Merdian" should reach "Meridian Water
// Corporation (Demo)" without being penalised for the words it never typed.
export function fuzzyEntityMatch(text, candidates = [], { threshold = 0.75 } = {}) {
  const words = String(text ?? '')
    .toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/)
    .filter(w => w.length >= 4 && !LEARN_STOP.has(w))
  if (!words.length) return null

  let best = null
  for (const c of candidates) {
    const name = c?.name
    if (!name) continue
    const parts = name.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(p => p.length >= 4)
    for (const w of words) {
      for (const p of parts) {
        // An exactly-typed word is not a typo, so it is never itself a suggestion —
        // but it must not stop the search either. "Horzion Power" spells Power
        // correctly, and bailing out there would miss the misspelt word beside it.
        if (w === p) continue
        const score = simRatio(w, p)
        if (score >= threshold && (!best || score > best.score)) best = { entity: c, score, typed: w, meant: p }
      }
    }
  }
  return best
}

// ── Partial name matching ─────────────────────────────────────────────────────
// People say "Meridian", not "Meridian Water Corporation (Demo)". Requiring the
// full name meant such questions silently widened to the whole portfolio.
//
// Distinctiveness is measured against the candidate set rather than a fixed word
// list: a token shared by several names ("Project", "Power", "Program") cannot
// identify one of them, while a token unique to one name can. That self-tunes as
// clients are added, instead of needing a stop-list maintained by hand.
export function distinctiveNameTokens(candidates = []) {
  const tokensOf = n => [...new Set(String(n ?? '').toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(w => w.length >= 4 && !LEARN_STOP.has(w)))]
  const freq = new Map()
  candidates.forEach(c => tokensOf(c?.name).forEach(t => freq.set(t, (freq.get(t) ?? 0) + 1)))
  const out = new Map()
  candidates.forEach(c => out.set(c.id, tokensOf(c?.name).filter(t => freq.get(t) === 1)))
  return out
}

// Best candidate whose distinctive tokens appear in the text. Returns null when
// nothing matches, or when two candidates tie — an ambiguous guess is worse than
// admitting the question was ambiguous.
export function matchByPartialName(text, candidates = []) {
  const t = ` ${String(text ?? '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ')} `
  const dist = distinctiveNameTokens(candidates)
  const scored = candidates
    .map(c => ({ c, hits: (dist.get(c.id) ?? []).filter(tok => t.includes(` ${tok} `)).length }))
    .filter(x => x.hits > 0)
    .sort((a, b) => b.hits - a.hits)
  if (!scored.length) return null
  if (scored.length > 1 && scored[0].hits === scored[1].hits) {
    return { ambiguous: scored.filter(x => x.hits === scored[0].hits).map(x => x.c) }
  }
  return { entity: scored[0].c }
}

// ── Programme story ───────────────────────────────────────────────────────────
// Composes the separate signals into the update a change lead would actually give:
// where we are, which way it is moving, what is in the way, and what needs a
// decision. Pure — the runner gathers, this shapes.
//
// Every section is omitted when its data is absent rather than padded with a
// placeholder, and the closing section names what is missing. A story that reads
// complete when half the inputs are empty is worse than a short one.
export function buildProgrammeStory({
  projectName, clientName, today = new Date(),
  pct = 0, phases = [], trend = null, milestones = [], atRisk = [], plannedEnd = null,
  heat = null, gate = null, comms = null, issues = null,
} = {}) {
  const fmt = d => d ? new Date(typeof d === 'string' ? d + 'T00:00:00' : d)
    .toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : null
  const sections = []
  const gaps = []

  // Where we are
  const active = phases.find(p => p.pct > 0 && p.pct < 100)
  const done = phases.filter(p => p.pct >= 100).length
  let where = `**${projectName}** is **${pct}% complete** on activities`
  if (phases.length) where += `, with ${done} of ${phases.length} phases fully closed`
  if (active) where += ` and **${active.name}** underway at ${active.pct}%`
  where += '.'
  sections.push({ heading: 'Where we are', body: where })

  // Which way it is moving
  if (trend?.perWeek != null) {
    const dir = trend.verdict === 'stalled' ? 'has stalled' : `is moving at about **${trend.perWeek}%/week**`
    let body = `Progress ${dir}`
    // Activity completion runs fast in early phases and slowly in late ones, so a
    // straight-line projection off it routinely "finishes" months before the last
    // phase is even scheduled to begin. Reporting that as a forecast date is worse
    // than reporting no date: it invites a decision on a number that cannot happen.
    const impossible = trend.forecastBeforePlan ?? (trend.forecast && plannedEnd && new Date(trend.forecast) < new Date(plannedEnd + 'T00:00:00'))
    if (trend.forecast && !impossible) {
      body += `, which lands completion around **${fmt(trend.forecast)}**`
      if (trend.slipDays > 0) body += ` — **${trend.slipDays} days past** the planned finish`
      else if (trend.slipDays < 0) body += ` — ${Math.abs(trend.slipDays)} days ahead`
    } else if (impossible) {
      body += `. At that rate the activity burn-down finishes early, but the plan still runs to **${fmt(plannedEnd)}** — the remaining phases are scheduled, not merely unstarted, so treat the rate as a health signal rather than a finish date`
    }
    sections.push({ heading: 'Which way it is moving', body: body.endsWith('date') ? body + '.' : body + '.' })
  } else {
    gaps.push('not enough history to compute velocity')
  }

  // What is in the way
  const inWay = []
  if (atRisk.length) inWay.push(`${atRisk.length} phase${atRisk.length === 1 ? ' is' : 's are'} past their planned end date (${atRisk.slice(0, 3).map(r => r.name).join(', ')})`)
  const openIssues = (issues?.issues ?? []).filter(i => i.status === 'open')
  const highIssues = openIssues.filter(i => i.severity === 'high')
  if (openIssues.length) {
    inWay.push(`${openIssues.length} open issue${openIssues.length === 1 ? '' : 's'}${highIssues.length ? `, ${highIssues.length} of them high severity` : ''}`)
  }
  const blockedComms = (comms?.items ?? []).filter(c => c.status === 'blocked')
  if (blockedComms.length) {
    inWay.push(`${blockedComms.length} communication${blockedComms.length === 1 ? ' is' : 's are'} blocked upstream (${blockedComms.map(c => c.message).join(', ')})`)
  }
  // A missing input is a gap whether or not the section happened to render from the
  // other inputs. Reporting it only when the section is empty means a blocked comm
  // can hide the fact that nobody is keeping an issues log at all.
  if (!issues) gaps.push('no issues log')
  if (inWay.length) {
    let body = inWay.join('; ') + '.'
    if (highIssues.length) {
      body += ' ' + highIssues.map(i => `**${i.title}** (${i.ref}, ${i.owner ?? 'no owner'}) — ${i.detail}`).join(' ')
    }
    sections.push({ heading: 'What is in the way', body })
  } else if (issues) {
    sections.push({ heading: 'What is in the way', body: 'Nothing overdue and no open issues.' })
  }

  // Who it lands on
  if (heat?.rows?.length) {
    const ranked = heat.rows.map(r => ({
      name: r.label,
      total: (r.cells ?? []).reduce((s, lv) => s + (LV_W[lv] || 0), 0),
      peak: (r.cells ?? []).reduce((m, lv) => ((LV_W[lv] || 0) > (LV_W[m] || 0) ? lv : m), 'none'),
    })).sort((a, b) => b.total - a.total)
    const top = ranked.slice(0, 2)
    sections.push({
      heading: 'Who it lands on',
      body: `Impact concentrates on **${top.map(g => g.name).join('** and **')}** (${LV_LABEL[top[0].peak]} at its peak). ${heat.commentary ?? ''}`.trim(),
    })
  } else {
    gaps.push('no impact assessment')
  }

  // Are we ready
  if (gate?.units?.length) {
    const ready = gate.units.filter(u => u.status === 'ready').length
    const unassessed = gate.units.filter(u => u.status === 'not_assessed')
    const risky = gate.units.filter(u => u.status === 'at_risk')
    let body = `**${ready} of ${gate.units.length}** business units are ready for ${gate.gate_name ? `the **${gate.gate_name}** gate` : 'the gate'}${gate.decision_due ? `, decided ${fmt(gate.decision_due)}` : ''}.`
    if (risky.length) body += ` ${risky.map(u => `**${u.unit}** is at risk — ${String(u.open).replace(/\.$/, '')}.`).join(' ')}`
    if (unassessed.length) body += ` ${unassessed.map(u => u.unit).join(' and ')} ${unassessed.length === 1 ? 'has' : 'have'} not been assessed at all, so ${unassessed.length === 1 ? 'it is' : 'they are'} not counted as ready.`
    sections.push({ heading: 'Are we ready', body })
  } else {
    gaps.push('no readiness gate')
  }

  // What needs a decision
  const pending = (issues?.decisions ?? []).filter(d => d.status === 'pending')
  const next = milestones.slice(0, 2)
  const decide = []
  if (pending.length) decide.push(...pending.map(d => `**${d.title}** — ${d.detail} (${d.owner ?? 'unowned'})`))
  if (next.length) decide.push(`Next up: ${next.map(m => `${m.name} (${fmt(m.date ?? m.milestone_date)})`).join(', ')}.`)
  if (decide.length) sections.push({ heading: 'What needs a decision', body: decide.join(' ') })

  return {
    title: `${projectName} — programme update`,
    subtitle: [clientName, fmt(today)].filter(Boolean).join(' · '),
    sections,
    gaps,
  }
}

// Render the story as the markdown body a narrative widget expects.
export function renderStory(story) {
  if (!story) return ''
  const parts = story.sections.map(s => `**${s.heading}**\n\n${s.body}`)
  if (story.gaps?.length) {
    parts.push(`_Not covered, because the data isn't there yet: ${story.gaps.join('; ')}._`)
  }
  return parts.join('\n\n')
}

// ── Heat map from audiences ───────────────────────────────────────────────────
// The heat map used to exist only as a hand-authored artifact. Audiences carry a
// rating per domain, so the table a client fills in anyway becomes the heat map.
export const HEAT_DOMAINS = [
  { key: 'impact_people',      label: 'People' },
  { key: 'impact_process',     label: 'Process' },
  { key: 'impact_information', label: 'Information' },
  { key: 'impact_technology',  label: 'Technology' },
]

// Returns the same shape the heatmap widget already renders, or null when no audience
// has been rated — an unrated set must not draw a grid of grey dots that looks like a
// real assessment saying "no impact anywhere".
export function heatmapFromAudiences(audiences = []) {
  const rated = (audiences ?? []).filter(a => HEAT_DOMAINS.some(d => a?.[d.key]))
  if (!rated.length) return null

  const rows = rated
    .slice()
    .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
    .map(a => ({
      label: a.name,
      // A domain nobody rated is 'none' for rendering, but see unratedCount below —
      // partial ratings are reported rather than passed off as complete.
      cells: HEAT_DOMAINS.map(d => a[d.key] ?? 'none'),
      headcount: a.headcount ?? null,
    }))

  const unrated = rated.reduce((n, a) => n + HEAT_DOMAINS.filter(d => !a[d.key]).length, 0)
  const notes = rated.filter(a => a.impact_note).map(a => `**${a.name}** — ${a.impact_note}`)
  const dates = rated.map(a => a.impact_rated_on).filter(Boolean).sort()

  return {
    cols: HEAT_DOMAINS.map(d => d.label),
    rows,
    commentary: notes.length ? notes.join(' ') : null,
    ratedOn: dates.length ? dates[dates.length - 1] : null,
    unratedCells: unrated,
    // Audiences that exist but carry no rating at all. Reported, not hidden: a heat map
    // missing a whole group is a different thing from one where a group scores low.
    missing: (audiences ?? []).filter(a => !HEAT_DOMAINS.some(d => a?.[d.key])).map(a => a.name),
  }
}

// An audience's overall impact is the PEAK of its four domain ratings, never a
// separately stored field. Storing both let the row contradict itself: an overall
// of "not rated" sitting beside three High domains. Peak rather than average,
// because a group whose work changes completely in one domain is highly impacted
// even if the other three are untouched — averaging would hide exactly the case
// that matters most.
export function overallImpact(audience) {
  const rated = HEAT_DOMAINS.map(d => audience?.[d.key]).filter(Boolean)
  if (!rated.length) return null
  return rated.reduce((peak, lv) => ((LV_W[lv] ?? 0) > (LV_W[peak] ?? 0) ? lv : peak), 'none')
}

// ── Training needs matrix ────────────────────────────────────────────────────
export const DELIVERY_LABEL = {
  classroom: 'Classroom', virtual: 'Virtual', self_paced: 'Self-paced',
  on_the_job: 'On the job', briefing: 'Briefing',
}
export const MODULE_STATUS_LABEL = {
  planned: 'Planned', in_build: 'In build', ready: 'Ready', retired: 'Retired',
}

// Turns flat training_demand rows into the grid a change manager actually asks for:
// audiences down the side, modules across the top. Pure so it can be tested without
// Supabase, and so the report and the screen cannot build the grid differently.
export function buildNeedsMatrix(demand, { audiences = [], modules = [] } = {}) {
  const rows = audiences.length ? audiences.map(a => ({ id: a.id, name: a.name, headcount: a.headcount ?? null, owner: a.owner_name ?? null }))
    : dedupeBy(demand, d => d.audience_id).map(d => ({ id: d.audience_id, name: d.audience_name, headcount: null, owner: d.audience_owner ?? null }))
  const cols = modules.length ? modules.map(m => ({ id: m.id, name: m.name, delivery: m.delivery ?? null, status: m.status ?? null }))
    : dedupeBy(demand, d => d.module_id).map(d => ({ id: d.module_id, name: d.module_name, delivery: d.delivery ?? null, status: d.module_status ?? null }))

  const byCell = new Map()
  for (const d of demand ?? []) byCell.set(`${d.audience_id}|${d.module_id}`, d)

  const cells = rows.map(r => cols.map(c => {
    const d = byCell.get(`${r.id}|${c.id}`)
    // No row in training_needs means not required. That is a real answer, distinct
    // from "required but we don't know how many" — which is what size_unknown is for.
    if (!d) return null
    const needed = d.people_needed ?? null
    return { necessity: d.necessity, needed, unknown: needed == null, partial: d.applies_to != null, notes: d.notes ?? null }
  }))

  return { rows, cols, cells }
}

function dedupeBy(list, key) {
  const seen = new Map()
  for (const item of list ?? []) if (!seen.has(key(item))) seen.set(key(item), item)
  return [...seen.values()]
}

// Headline numbers for the matrix. Deliberately reports what is NOT known alongside
// what is: a "1,240 training places" figure that quietly omits two unsized groups is
// worse than no figure, because nobody thinks to question it.
export function summariseDemand(demand) {
  const list = demand ?? []
  const mandatory = list.filter(d => d.necessity === 'mandatory')
  const sized = mandatory.filter(d => d.people_needed != null)
  const unsized = mandatory.filter(d => d.people_needed == null)
  const notReady = dedupeBy(list.filter(d => d.module_status && d.module_status !== 'ready'), d => d.module_id)
  return {
    // Places, not people: someone needing three modules occupies three seats, which is
    // the number that determines how many sessions have to be run.
    places: sized.reduce((s, d) => s + d.people_needed, 0),
    sizedNeeds: sized.length,
    unsizedNeeds: unsized.length,
    unsizedGroups: [...new Set(unsized.map(d => d.audience_name))],
    modules: dedupeBy(list, d => d.module_id).length,
    audiences: dedupeBy(list, d => d.audience_id).length,
    notReadyModules: notReady.map(d => ({ name: d.module_name, status: d.module_status })),
  }
}

// ── Training coverage (people-leader self-report) ────────────────────────────
export const GAP_REASON_LABEL = {
  never_reported:  'never reported',
  not_answered:    'asked, not answered',
  size_unknown:    'group size unknown',
  nobody_to_train: 'nobody to train',
}

// A check older than this is reported as stale rather than current. Three weeks is a
// missed fortnightly cycle plus a week of grace — long enough not to nag, short enough
// that "88% trained" from six weeks ago cannot be quoted at a go-live gate as if it
// were today's number.
export const STALE_AFTER_DAYS = 21

export function daysBetween(from, to) {
  if (!from || !to) return null
  const a = new Date(from), b = new Date(to)
  if (isNaN(a) || isNaN(b)) return null
  return Math.round((b - a) / 86400000)
}

export function isStale(lastChecked, asOf, days = STALE_AFTER_DAYS) {
  const d = daysBetween(lastChecked, asOf)
  return d == null ? false : d > days
}

// Rolls coverage rows into the numbers a steering committee is shown. Every branch
// here exists to stop an unknown being presented as a fact.
export function summariseCoverage(rows, { asOf = new Date().toISOString().slice(0, 10) } = {}) {
  const list = (rows ?? []).filter(r => r.necessity === 'mandatory')

  // Only rows with both a denominator and an answer can contribute to a percentage.
  const countable = list.filter(r => r.pct != null)
  const needed  = countable.reduce((s, r) => s + (r.people_needed ?? 0), 0)
  const trained = countable.reduce((s, r) => s + (r.trained ?? 0), 0)

  const blocked = list.filter(r => r.module_status && r.module_status !== 'ready')
  const stale   = countable.filter(r => isStale(r.last_checked, asOf))

  return {
    // NULL, not 0, when nothing is countable. A programme that has asked nobody is not
    // a programme at 0% trained, and the two must not render the same.
    pct: needed > 0 ? Math.round((100 * trained) / needed) : null,
    trained, needed,
    countable: countable.length,
    total: list.length,
    // Grouped by reason so the report can say what is missing, not just how much.
    gaps: list.filter(r => r.gap_reason).reduce((acc, r) => {
      (acc[r.gap_reason] ??= []).push(`${r.audience_name} · ${r.module_name}`)
      return acc
    }, {}),
    // Reported separately from coverage: a leader cannot train people on material that
    // does not exist, so these are the programme's problem, not the leader's.
    blocked: blocked.map(r => ({ audience: r.audience_name, module: r.module_name, status: r.module_status })),
    stale: stale.map(r => ({ audience: r.audience_name, module: r.module_name, lastChecked: r.last_checked, days: daysBetween(r.last_checked, asOf) })),
    unreported: list.filter(r => r.gap_reason === 'never_reported').length,
  }
}

// Movement between the two most recent answers for one need. "Stalled at 70%" and
// "reached 70% this week" are opposite situations that a single percentage hides.
export function coverageTrend(checks) {
  const answered = (checks ?? []).filter(c => c.trained != null)
    .sort((a, b) => (a.as_at < b.as_at ? -1 : 1))
  if (answered.length < 2) return null
  const prev = answered[answered.length - 2], last = answered[answered.length - 1]
  const delta = last.trained - prev.trained
  return { delta, from: prev.as_at, to: last.as_at, direction: delta > 0 ? 'up' : delta < 0 ? 'down' : 'flat' }
}

// Whether mandatory training clears a go-live gate. Deliberately three-valued: an
// answer of "not enough evidence" is honest, and is not the same as a pass or a fail.
export function coverageVerdict(summary, { threshold = 95 } = {}) {
  if (summary.countable === 0) return { verdict: 'unknown', why: 'No mandatory need has a reportable percentage yet.' }
  if (summary.unreported > 0 || Object.keys(summary.gaps).length > 0) {
    const missing = summary.total - summary.countable
    return { verdict: 'incomplete', why: `${missing} of ${summary.total} mandatory needs have no reportable coverage.` }
  }
  if (summary.pct != null && summary.pct >= threshold) return { verdict: 'pass', why: `${summary.pct}% of mandatory places delivered.` }
  return { verdict: 'short', why: `${summary.pct}% against a ${threshold}% threshold.` }
}
