// ChangeFlow · AI Rules engine
//
// The first (and cheapest) tier of the AI router. Deterministic intent matching over the
// user's text, then a grounded, RLS-scoped Supabase query — no language model touches the
// numbers. Everything here is scoped automatically: the browser's supabase client carries
// the caller's session, so Master Admin sees all clients, Client Admin sees theirs, a
// member sees their own projects. Same data path as the dashboards, one source of truth.
//
// matchIntent() is pure (no network) so it can be unit-tested. run*() do the grounded query.

import { supabase } from '../supabase'
import { matchIntent } from './intents'
import { buildReportGantt, buildIntegratedInsight, distinctiveTokens, resolveScope, scopedProjects, buildPhaseDrill, LV_W, LV_LABEL, renderTemplate, matchKnowledgeRule, computeTrend, trendSentence, buildTrendChart, buildProgrammeStory, heatmapFromAudiences } from './analysis'
import { slmAvailable, slmGenerate } from './slm'

export { matchIntent }

const PHASES = [1, 2, 3, 4, 5]
const PHASE_NAMES = { 1: 'Diagnose', 2: 'Design', 3: 'Engage', 4: 'Embed', 5: 'Evaluate' }

// ── Shared grounded data load (role-scoped by RLS) ────────────────────────────
async function loadData() {
  const today = new Date()
  const [{ data: clients }, { data: projects }] = await Promise.all([
    supabase.from('clients').select('id, name, industry').order('name'),
    supabase.from('projects').select('id, name, client_id'),
  ])
  const projIds = (projects ?? []).map(p => p.id)

  let members = [], pathways = [], phaseRows = [], milestones = [], acts = [], surveys = [], profiles = []
  if (projIds.length) {
    const [{ data: m }, { data: pw }, { data: ph }, { data: ms }] = await Promise.all([
      supabase.from('project_members').select('project_id, user_id').in('project_id', projIds),
      supabase.from('project_pathways').select('project_id, phase_number, content_id').in('project_id', projIds),
      supabase.from('project_phases').select('project_id, phase_number, planned_start, planned_end, status').in('project_id', projIds),
      supabase.from('project_milestones').select('project_id, name, milestone_date, color').in('project_id', projIds),
    ])
    members = m ?? []; pathways = pw ?? []; phaseRows = ph ?? []; milestones = ms ?? []
    const ids = [...new Set(members.map(x => x.user_id))]
    if (ids.length) {
      const [{ data: a }, { data: s }, { data: pr }] = await Promise.all([
        supabase.from('user_activities').select('user_id, content_id, status').in('user_id', ids).eq('status', 'completed'),
        supabase.from('survey_responses').select('user_id, score, submitted_at').in('user_id', ids).not('submitted_at', 'is', null),
        supabase.from('profiles').select('id, full_name, role').in('id', ids),
      ])
      acts = a ?? []; surveys = s ?? []; profiles = pr ?? []
    }
  }

  const clientName = id => (clients ?? []).find(c => c.id === id)?.name ?? ''

  // Per-project rollup with per-phase and per-member completion.
  const projRollup = (projects ?? []).map(p => {
    const pMembers = [...new Set(members.filter(m => m.project_id === p.id).map(m => m.user_id))]
    const phasesOut = PHASES.map(n => {
      const cIds = new Set(pathways.filter(pw => pw.project_id === p.id && pw.phase_number === n).map(pw => pw.content_id))
      const steps = cIds.size
      const total = steps * Math.max(pMembers.length, 1)
      const done = acts.filter(a => pMembers.includes(a.user_id) && cIds.has(a.content_id)).length
      const row = phaseRows.find(r => r.project_id === p.id && r.phase_number === n)
      // Per-member done count for this phase (for members_behind).
      const perMember = pMembers.map(uid => ({
        user_id: uid,
        done: acts.filter(a => a.user_id === uid && cIds.has(a.content_id)).length,
        steps,
      }))
      return {
        phase_number: n, name: PHASE_NAMES[n],
        planned_start: row?.planned_start ?? null, planned_end: row?.planned_end ?? null,
        status: row?.status ?? 'locked', steps, done, total,
        pct: total > 0 ? Math.round((done / total) * 100) : 0, perMember,
      }
    })
    const done = phasesOut.reduce((s, x) => s + x.done, 0)
    const total = phasesOut.reduce((s, x) => s + x.total, 0)
    return {
      id: p.id, name: p.name, client_id: p.client_id, clientName: clientName(p.client_id),
      members: pMembers.length, memberIds: pMembers,
      pct: total > 0 ? Math.round((done / total) * 100) : 0,
      phases: phasesOut, milestones: milestones.filter(m => m.project_id === p.id), done, total,
    }
  })

  // Exported as clientNameOf, not clientName: it is a LOOKUP, and interpolating it
  // into a template literal printed the function's source into CORA's answer.
  return { today, clients: clients ?? [], projRollup, milestones, surveys, profiles, clientNameOf: clientName }
}

const nameOf = (profiles, id) => profiles.find(p => p.id === id)?.full_name ?? 'Member'
const roleOf = (profiles, id) => profiles.find(p => p.id === id)?.role ?? null

// ── Context scoping ───────────────────────────────────────────────────────────
// Resolve which client/project an aggregate question is about — named in the text, or (for
// phrase-less follow-ups) the entity CORA is remembering. Lets "what's at risk" scope to the
// client/project currently under discussion.
// resolveScope + scopedProjects live in ./analysis (pure, unit-tested); imported above.

// ── Intent runners → widget descriptors ───────────────────────────────────────
async function runAtRisk(_params, text, ctx) {
  const data = await loadData()
  const scope = resolveScope(text, ctx, data)
  const cp = scopedProjects(data, scope), today = data.today
  const rows = []
  cp.forEach(p => p.phases.forEach(ph => {
    if (ph.planned_end && new Date(ph.planned_end) < today && ph.pct < 100 && ph.steps > 0)
      rows.push({ rag: ph.pct < 40 ? 'r' : 'a', name: `${ph.name} · ${ph.project ?? p.name}`,
        meta: `${p.clientName} · ${ph.pct}% complete`, due: 'overdue' })
  }))
  return {
    type: 'list', title: `At-risk items${scope.suffix}`, empty: `Nothing overdue${scope.label ? ` for ${scope.label}` : ' — everything on track'}.`,
    rows: rows.slice(0, 12),
    commentary: rows.length ? `${rows.length} phase${rows.length > 1 ? 's are' : ' is'} past its planned end date and under 100%. The red items are below 40% — those need attention first.` : null,
  }
}

async function runMilestones(_params, text, ctx) {
  const data = await loadData()
  const scope = resolveScope(text, ctx, data)
  const cp = scopedProjects(data, scope), today = data.today
  const ids = new Set(cp.map(p => p.id))
  const projName = id => data.projRollup.find(p => p.id === id)?.name ?? 'Project'
  const soon = new Date(today); soon.setDate(soon.getDate() + 7)
  const rows = (data.milestones ?? [])
    .filter(m => (!scope.label || ids.has(m.project_id)) && m.milestone_date && new Date(m.milestone_date) >= today && new Date(m.milestone_date) <= soon)
    .sort((a, b) => new Date(a.milestone_date) - new Date(b.milestone_date))
    .map(m => {
      const days = Math.ceil((new Date(m.milestone_date) - today) / 86400000)
      return { rag: days <= 2 ? 'a' : 'g', name: m.name, meta: projName(m.project_id), due: days <= 0 ? 'today' : `in ${days}d` }
    })
  return {
    type: 'list', title: `Milestones due in the next 7 days${scope.suffix}`, empty: 'No milestones due this week.',
    rows, commentary: rows.length ? `${rows.length} milestone${rows.length > 1 ? 's' : ''} within 7 days. Amber ones fall due in ≤2 days.` : null,
  }
}

const RAG_WORD = { green: 'On track', amber: 'At risk', red: 'Critical' }
const ragOf = avg => avg == null ? null : avg >= 3.5 ? 'green' : avg >= 2.5 ? 'amber' : 'red'

async function runClients() {
  const { clients, projRollup, surveys } = await loadData()
  const rows = clients.map(c => {
    const cp = projRollup.filter(p => p.client_id === c.id)
    const memberIds = new Set(cp.flatMap(p => p.memberIds))
    const people = memberIds.size
    const done = cp.reduce((s, p) => s + p.done, 0)
    const total = cp.reduce((s, p) => s + p.total, 0)
    const pct = total > 0 ? Math.round((done / total) * 100) : 0
    const cScores = surveys.filter(s => memberIds.has(s.user_id) && s.score != null)
    const avg = cScores.length ? cScores.reduce((s, r) => s + r.score, 0) / cScores.length : null
    const rag = ragOf(avg)
    const base = `${cp.length} project${cp.length === 1 ? '' : 's'} · ${people} ${people === 1 ? 'person' : 'people'}`
    return { label: c.name, sub: rag ? `${base} · ${RAG_WORD[rag]}` : base, value: pct, rag, drill: `Show me the details on ${c.name}` }
  }).sort((a, b) => a.value - b.value)
  return {
    type: 'progress', title: `Clients (${rows.length})`, rows,
    empty: 'No clients yet.',
    commentary: rows.length ? `${rows.length} client${rows.length === 1 ? '' : 's'} on the platform, sorted by completion. Tap "Open admin" on the dashboard to manage any of them.` : null,
  }
}

async function runPeople() {
  const { projRollup, profiles } = await loadData()
  const rows = profiles.map(u => {
    const theirs = projRollup.filter(p => p.memberIds.includes(u.id))
    let done = 0, steps = 0
    theirs.forEach(p => p.phases.forEach(ph => { const mm = ph.perMember.find(x => x.user_id === u.id); if (mm) { done += mm.done; steps += mm.steps } }))
    const pct = steps > 0 ? Math.round((done / steps) * 100) : 0
    return { label: u.full_name ?? 'Member', sub: `${u.role ? u.role.toUpperCase() + ' · ' : ''}${theirs.length} project${theirs.length === 1 ? '' : 's'}`, value: pct, drill: `Show me ${u.full_name}` }
  }).sort((a, b) => a.value - b.value)
  return {
    type: 'progress', title: `People (${rows.length})`, rows, empty: 'No people assigned to projects yet.',
    commentary: rows.length ? `${rows.length} ${rows.length === 1 ? 'person' : 'people'} across all projects, sorted by completion. Click anyone to see their detail.` : null,
  }
}

// Compute grounded insights from a heat-map grid (not a one-liner): hottest groups + domain,
// the actual High+ hotspots, the spread, lightest touch, and a sequencing recommendation.
function analyseHeatmap(data) {
  const SCORE = { vh: 5, h: 4, m: 3, l: 2, vl: 1, none: 0 }
  const LBL = { vh: 'Very High', h: 'High', m: 'Medium', l: 'Low', vl: 'Very Low', none: 'None' }
  const cols = data.cols ?? [], rows = data.rows ?? []
  if (!rows.length || !cols.length) return []
  const rowTotals = rows.map(r => ({ label: r.label, total: r.cells.reduce((s, c) => s + (SCORE[c] ?? 0), 0) })).sort((a, b) => b.total - a.total)
  const colTotals = cols.map((c, ci) => ({ label: c, total: rows.reduce((s, r) => s + (SCORE[r.cells[ci]] ?? 0), 0) })).sort((a, b) => b.total - a.total)
  const hotspots = []
  const counts = {}
  rows.forEach(r => r.cells.forEach((c, ci) => { counts[c] = (counts[c] || 0) + 1; if (c === 'vh' || c === 'h') hotspots.push(`${r.label} · ${cols[ci]} (${LBL[c]})`) }))
  const totalCells = rows.length * cols.length
  const highPlus = (counts.vh || 0) + (counts.h || 0)
  const out = [
    `**Highest-impact groups:** ${rowTotals.slice(0, 2).map(r => r.label).join(' and ')} — focus change effort, comms and champions here first.`,
    `**Most-affected domain:** ${colTotals[0].label}${colTotals[1] ? `, then ${colTotals[1].label}` : ''} across the register — align training and readiness to it.`,
    hotspots.length ? `**${hotspots.length} hotspot${hotspots.length > 1 ? 's' : ''} at High or above:** ${hotspots.slice(0, 6).join('; ')}${hotspots.length > 6 ? ` +${hotspots.length - 6} more` : ''}.` : 'No cells rated High or above.',
    `**Spread:** ${highPlus} of ${totalCells} cells are High+, ${counts.m || 0} Medium, ${(counts.l || 0) + (counts.vl || 0)} Low.`,
    `**Lightest touch:** ${rowTotals[rowTotals.length - 1].label} — keep informed, but don't over-invest engagement there.`,
    `**Recommendation:** sequence engagement starting with ${rowTotals[0].label}; prioritise ${colTotals[0].label} interventions, and revisit as the assessment is re-versioned.`,
  ]
  return out
}

// Retrieve a stored heat-map artifact. Works whether or not a client is named:
//  • names a client  → that client's current heat map
//  • no client, one available (RLS-scoped) → show it
//  • no client, several → ask which
async function runHeatmap(_params, text, ctx) {
  // Audiences first. A heat map built from the audiences a client actually maintains
  // beats a hand-authored artifact that goes stale the day it is captured — and it
  // means a client can produce one at all, which was not previously possible.
  try {
    const data0 = await loadData()
    const scope = resolveScope(text, ctx ?? {}, data0)
    const projIds = scopedProjects(data0, scope).map(p => p.id)
    if (projIds.length === 1) {
      const { data: auds } = await supabase.from('audiences')
        .select('name, sort_order, headcount, impact_people, impact_process, impact_information, impact_technology, impact_note, impact_rated_on')
        .eq('project_id', projIds[0]).order('sort_order')
      const built = heatmapFromAudiences(auds ?? [])
      if (built) {
        const ranked = built.rows.map(r => ({
          name: r.label,
          total: r.cells.reduce((s2, lv) => s2 + (LV_W[lv] || 0), 0),
          peak: r.cells.reduce((m, lv) => ((LV_W[lv] || 0) > (LV_W[m] || 0) ? lv : m), 'none'),
          highs: r.cells.filter(lv => lv === 'vh' || lv === 'h').length,
        })).sort((a, b) => b.total - a.total)
        const top = ranked.filter(g => g.peak === 'vh' || g.peak === 'h')
        const lead = top.length
          ? `The most impacted groups are **${top.slice(0, 3).map(g => g.name).join('**, **')}**. ` +
            top.slice(0, 3).map(g => `${g.name} peaks at ${LV_LABEL[g.peak]} across ${g.highs} domain${g.highs === 1 ? '' : 's'}`).join('; ') +
            '. Focus engagement and comms there first.'
          : ranked.length ? `No group is rated High or Very High — the heaviest is **${ranked[0].name}**.` : null
        // Gaps are stated, not hidden: a heat map missing a group entirely is a
        // different thing from one where that group scores low.
        const gaps = []
        if (built.missing.length) gaps.push(`${built.missing.join(', ')} ${built.missing.length === 1 ? 'has' : 'have'} not been rated`)
        if (built.unratedCells) gaps.push(`${built.unratedCells} domain rating${built.unratedCells === 1 ? '' : 's'} still blank`)
        return {
          type: 'heatmap', title: `${scope.label ?? 'Impact'} — stakeholder impact${scope.suffix}`,
          cols: built.cols, rows: built.rows,
          source: built.ratedOn ? `audiences · rated ${fmtDate(built.ratedOn)}` : 'audiences',
          intro: lead, headline: built.commentary,
          insights: gaps.length ? [`**Gaps:** ${gaps.join('; ')}.`] : [],
        }
      }
    }
  } catch { /* fall through to the stored artifact */ }

  const [{ data: arts }, { data: clients }] = await Promise.all([
    supabase.from('change_artifacts').select('client_id, title, version, source, data').eq('type', 'stakeholder_heatmap').eq('is_current', true).order('version', { ascending: false }),
    supabase.from('clients').select('id, name'),
  ])
  const list = arts ?? []
  const t = (text ?? '').toLowerCase()
  const named = (clients ?? []).find(c => c.name && c.name.length >= 3 && t.includes(c.name.toLowerCase()))
  const nameOfClient = id => (clients ?? []).find(c => c.id === id)?.name ?? ''

  let pick = null
  if (named) pick = list.find(a => a.client_id === named.id)
  else if (list.length === 1) pick = list[0]

  if (pick) {
    // "Who are the high-impacted stakeholders?" deserves a direct answer, not just a grid — rank
    // the groups by total severity and name the top ones first.
    const ranked = (pick.data.rows ?? []).map(r => {
      const cells = r.cells ?? []
      const total = cells.reduce((s, lv) => s + (LV_W[lv] || 0), 0)
      const peak = cells.reduce((m, lv) => ((LV_W[lv] || 0) > (LV_W[m] || 0) ? lv : m), 'none')
      const highs = cells.filter(lv => lv === 'vh' || lv === 'h').length
      return { name: r.label, total, peak, highs }
    }).sort((a, b) => b.total - a.total)
    const top = ranked.filter(g => g.peak === 'vh' || g.peak === 'h')
    const lead = top.length
      ? `The most impacted groups are **${top.slice(0, 3).map(g => g.name).join('**, **')}**. ` +
        top.slice(0, 3).map(g => `${g.name} peaks at ${LV_LABEL[g.peak]} across ${g.highs} domain${g.highs === 1 ? '' : 's'}`).join('; ') +
        '. Focus engagement and comms there first.'
      : ranked.length ? `No group is rated High or Very High — the heaviest is **${ranked[0].name}**.` : null

    return { type: 'heatmap', title: `${nameOfClient(pick.client_id)} — ${pick.title}`,
      cols: pick.data.cols, rows: pick.data.rows, version: pick.version, source: pick.source,
      intro: lead, headline: pick.data.commentary ?? null, insights: analyseHeatmap(pick.data) }
  }
  if (list.length > 1) {
    const names = [...new Set(list.map(a => nameOfClient(a.client_id)).filter(Boolean))]
    return { type: 'narrative', title: 'Which heat map?', body: `I have stakeholder heat maps for: **${names.join('**, **')}**. Ask e.g. "show me the heat map for ${names[0]}".` }
  }
  return { type: 'narrative', title: 'No heat map yet', body: named ? `No heat map captured for **${named.name}** yet — attach the stakeholder-mapping slide and I'll capture it.` : 'No heat maps captured yet. Attach a stakeholder-mapping slide in the AI Canvas and I\'ll capture it.' }
}

// Assemble a comprehensive change report for a client — snapshot, heat map, timeline,
// needs-attention, upcoming, readiness, recommendations. Sections are mini-descriptors the
// report widget renders with the existing renderers. Grounded; will grow over time.
async function runReport(_params, text, ctx) {
  const data = await loadData()
  const t = (text ?? '').toLowerCase()
  let client = data.clients.find(c => c.name && c.name.length >= 3 && t.includes(c.name.toLowerCase())) || (data.clients.length === 1 ? data.clients[0] : null)
  // Optional project scope: "...for RSR Program" narrows the whole report to one project.
  const candidateProjects = data.projRollup.filter(p => !client || p.client_id === client.id)
  let proj = candidateProjects.find(p => p.name && p.name.length >= 3 && t.includes(p.name.toLowerCase())) || null
  // Auto-scope to the conversation's context: an explicitly named client/project wins; otherwise
  // inherit the client or project CORA is already talking about, so "generate a report" just works.
  if (!proj && !client) {
    const ctxScope = resolveScope(text, ctx, data)
    if (ctxScope.proj) proj = ctxScope.proj
    else if (ctxScope.client) client = ctxScope.client
  }
  if (proj && !client) client = data.clients.find(c => c.id === proj.client_id) || client   // infer client from the named project
  if (!client && data.clients.length > 1) {
    return { type: 'narrative', title: 'Which client?', followup: 'report',
      body: `Name the client for the report — just reply with a name: ${data.clients.map(c => `**${c.name}**`).join(', ')}. You can also add a project, e.g. "**${data.clients[0].name} · ${(data.projRollup.find(p => p.client_id === data.clients[0].id)?.name) || 'a project'}**".` }
  }
  const cid = client?.id
  const cp = proj ? [proj] : data.projRollup.filter(p => !cid || p.client_id === cid)
  const scopeLabel = proj ? `${client?.name ?? ''} — ${proj.name}` : (client?.name ?? 'Programme')
  const memberIds = new Set(cp.flatMap(p => p.memberIds))
  const people = memberIds.size
  const done = cp.reduce((s, p) => s + p.done, 0), total = cp.reduce((s, p) => s + p.total, 0)
  const pct = total > 0 ? Math.round((done / total) * 100) : 0
  const scores = data.surveys.filter(s => memberIds.has(s.user_id) && s.score != null)
  const avg = scores.length ? scores.reduce((s, r) => s + r.score, 0) / scores.length : null
  const ragWord = avg == null ? 'not yet measured' : avg >= 3.5 ? 'Green — on track' : avg >= 2.5 ? 'Amber — at risk' : 'Red — critical'

  const atRisk = []
  cp.forEach(p => p.phases.forEach(ph => { if (ph.planned_end && new Date(ph.planned_end) < data.today && ph.pct < 100 && ph.steps > 0) atRisk.push({ rag: ph.pct < 40 ? 'r' : 'a', name: `${ph.name} · ${p.name}`, meta: `${ph.pct}% complete`, due: 'overdue' }) }))

  const soon = new Date(data.today); soon.setDate(soon.getDate() + 30)
  const projName = id => cp.find(p => p.id === id)?.name ?? 'Project'
  const upcoming = [
    ...data.milestones.filter(m => cp.some(p => p.id === m.project_id) && m.milestone_date && new Date(m.milestone_date) >= data.today && new Date(m.milestone_date) <= soon)
      .map(m => ({ rag: 'g', name: m.name, meta: projName(m.project_id), due: fmtDate(m.milestone_date), _d: m.milestone_date })),
    ...cp.flatMap(p => p.phases.filter(ph => ph.planned_start && new Date(ph.planned_start) > data.today && new Date(ph.planned_start) <= soon)
      .map(ph => ({ rag: 'g', name: `${ph.name} starts`, meta: p.name, due: fmtDate(ph.planned_start), _d: ph.planned_start }))),
  ].sort((a, b) => new Date(a._d) - new Date(b._d)).slice(0, 8)

  let heatSection = null, heatInsights = []
  // Audiences first, same as the canvas. The report used to read only the stored
  // artifact, so editing a rating changed CORA's answer and left the Word pack
  // showing the old grid — two answers to the same question, which is exactly how
  // the bogus trend forecast survived in the last report.
  if (cp.length === 1) {
    const { data: auds } = await supabase.from('audiences')
      .select('name, sort_order, headcount, impact_people, impact_process, impact_information, impact_technology, impact_note, impact_rated_on')
      .eq('project_id', cp[0].id).order('sort_order')
    const built = heatmapFromAudiences(auds ?? [])
    if (built) {
      const shaped = { cols: built.cols, rows: built.rows, commentary: built.commentary }
      heatInsights = analyseHeatmap(shaped)
      // Gaps are carried into the report too — a heat map missing a group must not
      // read as complete just because it is rendered in Word.
      const gaps = []
      if (built.missing.length) gaps.push(`${built.missing.join(', ')} ${built.missing.length === 1 ? 'has' : 'have'} not been rated`)
      if (built.unratedCells) gaps.push(`${built.unratedCells} domain rating${built.unratedCells === 1 ? '' : 's'} still blank`)
      if (gaps.length) heatInsights = [...heatInsights, `**Gaps:** ${gaps.join('; ')}.`]
      heatSection = {
        heading: 'Change impact heat map', type: 'heatmap',
        cols: built.cols, rows: built.rows,
        source: built.ratedOn ? `audiences · rated ${fmtDate(built.ratedOn)}` : 'audiences',
        headline: built.commentary, insights: heatInsights,
      }
    }
  }
  if (!heatSection && cid) {
    const { data: arts } = await supabase.from('change_artifacts').select('title, version, source, data').eq('client_id', cid).eq('type', 'stakeholder_heatmap').eq('is_current', true).order('version', { ascending: false }).limit(1)
    const a = arts?.[0]
    if (a) { heatInsights = analyseHeatmap(a.data); heatSection = { heading: 'Change impact heat map', type: 'heatmap', cols: a.data.cols, rows: a.data.rows, version: a.version, source: a.source, headline: a.data.commentary, insights: heatInsights } }
  }

  const integrated = heatSection ? buildIntegratedInsight(heatSection, { pct, atRisk, avg, ragWord, upcoming }) : null

  let sections = []
  sections.push({ heading: 'Executive summary', type: 'narrative', body:
    `**${scopeLabel}** — ${proj ? '1 project' : `${cp.length} project${cp.length === 1 ? '' : 's'}`}, ${people} ${people === 1 ? 'person' : 'people'}, **${pct}%** average completion. Readiness is **${ragWord}**.` +
    (atRisk.length ? ` **${atRisk.length}** phase${atRisk.length === 1 ? ' is' : 's are'} overdue and need attention.` : ' No phases are currently overdue.') })
  if (integrated) sections.push(integrated)
  sections.push({ heading: 'Programme snapshot', type: 'progress', empty: 'No projects yet.',
    rows: cp.map(p => ({ label: p.name, sub: `${p.members} ${p.members === 1 ? 'person' : 'people'}`, value: p.pct })).sort((a, b) => a.value - b.value) })
  if (heatSection) sections.push(heatSection)
  if (cp.length) sections.push({ heading: 'Delivery & change timeline', type: 'projectTimeline', projects: cp.map(p => ({ id: p.id, name: p.name })), gantt: buildReportGantt(cp) })
  sections.push({ heading: 'Needs attention', type: 'list', rows: atRisk, empty: 'Everything is on track.' })
  sections.push({ heading: 'Upcoming (next 30 days)', type: 'list', rows: upcoming, empty: 'Nothing scheduled ahead.' })
  sections.push({ heading: 'Readiness', type: 'narrative', body: `Average readiness **${avg == null ? '—' : avg.toFixed(1)}** (${ragWord})${scores.length ? ` from ${scores.length} survey response${scores.length === 1 ? '' : 's'}` : ' — no survey responses captured yet'}.` })

  // ── Trend & velocity ──
  // The rest of the report is "where we are". This is "are we improving, and will we make it?",
  // computed from the daily progress snapshots.
  try {
    const projIds = cp.map(p => p.id)
    if (projIds.length) {
      const { data: snaps } = await supabase.from('progress_snapshots')
        .select('captured_on, project_id, pct')
        .in('project_id', projIds).order('captured_on', { ascending: true })
      // One series per programme — averaging them would hide a moving programme behind a
      // stalled one, which is exactly the case this section exists to reveal.
      const perProject = cp.map(p => {
        const points = (snaps ?? []).filter(s => s.project_id === p.id)
          .map(s => ({ captured_on: s.captured_on, pct: Number(s.pct) }))
        const pEnds = p.phases.map(ph => ph.planned_end).filter(Boolean).sort()
        const plannedEnd = pEnds.length ? pEnds[pEnds.length - 1] : null
        const trend = computeTrend(points, { plannedEnd, today: data.today })
        return { name: p.name, points, plannedEnd, trend, forecast: trend.forecast ?? null }
      })

      // Chart against the latest planned end in scope; each line carries its own forecast.
      const allEnds = perProject.map(s => s.plannedEnd).filter(Boolean).sort()
      const chart = buildTrendChart(perProject, {
        plannedEnd: allEnds.length ? allEnds[allEnds.length - 1] : null,
        today: data.today,
      })
      const body = perProject.length === 1
        ? trendSentence(perProject[0].trend, fmtDate)
        : perProject.map(s => `**${s.name}** — ${trendSentence(s.trend, fmtDate)}`).join('\n\n')
      sections.push({ heading: 'Trend & velocity', type: 'trend', chart, series: perProject, body })
    }
  } catch { /* snapshots are optional — the report still stands without them */ }

  // Gate and comms were built after this report and never wired in, so the Word output
  // was missing the two sections the canvas leads with. Read from the same artifacts.
  try {
    const clientIds = [...new Set(cp.map(p => data.projRollup.find(x => x.id === p.id)?.client_id).filter(Boolean))]
    if (clientIds.length === 1) {
      const { data: arts } = await supabase.from('change_artifacts')
        .select('type, data').eq('client_id', clientIds[0]).eq('is_current', true)
      const of = t => (arts ?? []).find(a => a.type === t)?.data ?? null

      const gate = of('readiness_gate')
      if (gate?.units?.length) {
        const RAG = { ready: 'g', watch: 'a', at_risk: 'r', not_assessed: 'n' }
        const ready = gate.units.filter(u => u.status === 'ready').length
        const unassessed = gate.units.filter(u => u.status === 'not_assessed')
        sections.push({
          heading: 'Business readiness', type: 'list',
          rows: gate.units.map(u => ({ rag: RAG[u.status] ?? 'a', name: u.unit,
            meta: `${u.met}/${u.total} criteria${u.owner ? ` · ${u.owner}` : ' · unassigned'}`, due: u.open ?? '' })),
          commentary: `**${ready} of ${gate.units.length}** units ready${gate.decision_due ? `, decided ${fmtDate(gate.decision_due)}` : ''}.` +
            (unassessed.length ? ` ${unassessed.map(u => u.unit).join(' and ')} not assessed — not counted as ready.` : ''),
          empty: 'No gate captured.',
        })
      }

      const comms = of('comms_plan')
      if (comms?.items?.length) {
        const RAG = { sent: 'g', planned: 'a', blocked: 'r', overdue: 'r', deferred: 'a' }
        const sent = comms.items.filter(i => i.status === 'sent').length
        const blocked = comms.items.filter(i => i.status === 'blocked')
        sections.push({
          heading: 'Comms plan', type: 'list',
          rows: comms.items.map(i => ({ rag: RAG[i.status] ?? 'a', name: i.message,
            meta: `${i.audience}${i.size ? ` · ${i.size}` : ''} · ${i.channel}${i.owner ? ` · ${i.owner}` : ' · no owner'}`,
            due: `${i.date ? fmtDate(i.date) : '—'} · ${i.status}` })),
          commentary: `**${sent}/${comms.items.length}** sent, anchored to ${comms.anchor ?? 'the timeline'}.` +
            (blocked.length ? ` ${blocked.length} blocked upstream — the source output needs finishing, not the comm.` : ''),
          empty: 'No comms planned.',
        })
      }
    }
  } catch { /* artifacts are optional — the report stands without them */ }

  const recs = []
  // The stored insight is a sentence fragment continuing "Recommendation:", so it starts
  // lowercase. Dropping the prefix left the paragraph beginning mid-sentence.
  if (heatInsights.length) {
    const r = heatInsights[heatInsights.length - 1].replace(/^\*\*Recommendation:\*\*\s*/, '')
    recs.push(r.charAt(0).toUpperCase() + r.slice(1))
  }
  if (atRisk.length) recs.push(`Clear the ${atRisk.length} overdue phase${atRisk.length === 1 ? '' : 's'} first — they gate go-live.`)
  if (avg != null && avg < 3.5) recs.push('Lift survey readiness with targeted comms before the next gate.')
  if (!recs.length) recs.push('On track — maintain cadence and re-run this report as data updates.')
  sections.push({ heading: 'Recommendations', type: 'narrative', body: recs.join(' ') })

  // Learning precedence for narrative sections: this client's saved edit > platform standard
  // default (learned across clients) > freshly generated. Data sections always stay live.
  const [{ data: defs }, { data: edits }] = await Promise.all([
    supabase.from('change_artifacts').select('data').is('client_id', null).eq('type', 'report_defaults').eq('is_current', true).order('version', { ascending: false }).limit(1),
    cid ? supabase.from('change_artifacts').select('data').eq('client_id', cid).eq('type', 'report_edits').eq('is_current', true).order('version', { ascending: false }).limit(1) : Promise.resolve({ data: [] }),
  ])
  const defMap = defs?.[0]?.data ?? {}
  const cliMap = edits?.[0]?.data ?? {}
  sections = sections.map(s => {
    if (s.type !== 'narrative') return s
    if (cliMap[s.heading] != null) return { ...s, body: cliMap[s.heading], source: 'client' }
    if (defMap[s.heading] != null) return { ...s, body: defMap[s.heading], source: 'standard' }
    return s
  })

  return { type: 'report', title: `Change report — ${scopeLabel}`,
    subtitle: `Generated ${data.today.toLocaleDateString('en', { day: 'numeric', month: 'long', year: 'numeric' })}${proj ? ' · project scope' : ''} · grounded in live data`,
    client_id: cid ?? null, client_name: client?.name ?? null, project_id: proj?.id ?? null,
    // Carried so the exported file can be named for the client and the day it covers,
    // rather than inheriting whatever the card title happened to be.
    scope_label: scopeLabel, generated_on: data.today.toISOString().slice(0, 10),
    sections }
}

async function runUpcoming(_params, text, ctx) {
  const data = await loadData()
  const scope = resolveScope(text, ctx, data)
  const cp = scopedProjects(data, scope), today = data.today
  const ids = new Set(cp.map(p => p.id))
  const projName = id => data.projRollup.find(p => p.id === id)?.name ?? 'Project'
  const items = [
    ...(data.milestones ?? []).filter(m => (!scope.label || ids.has(m.project_id)) && m.milestone_date && new Date(m.milestone_date) >= today)
      .map(m => ({ date: m.milestone_date, label: m.name, project: projName(m.project_id) })),
    ...cp.flatMap(p => p.phases.filter(ph => ph.planned_start && new Date(ph.planned_start) > today)
      .map(ph => ({ date: ph.planned_start, label: `${ph.name} starts`, project: p.name }))),
  ].sort((a, b) => new Date(a.date) - new Date(b.date)).slice(0, 8)
  const rows = items.map(it => ({ rag: 'g', name: it.label, meta: it.project, due: fmtDate(it.date) }))
  return { type: 'list', title: `Upcoming milestones${scope.suffix}`, empty: 'Nothing scheduled ahead.', rows }
}

// ── Member-personal ("me") rules ──────────────────────────────────────────────
const PHASE_PATH = { 1: '/phases/diagnose', 2: '/phases/design', 3: '/phases/engage', 4: '/phases/embed', 5: '/phases/evaluate' }

async function myActiveProject() {
  const { data: { user } } = await supabase.auth.getUser()
  const uid = user?.id
  if (!uid) return { uid: null, projectId: null }
  const stored = (typeof localStorage !== 'undefined') ? localStorage.getItem('cf_active_project') : null
  const { data: mems } = await supabase.from('project_members').select('project_id').eq('user_id', uid)
  const ids = [...new Set((mems ?? []).map(m => m.project_id))]
  return { uid, projectId: (stored && ids.includes(stored)) ? stored : (ids[0] ?? null) }
}

async function runMyJourney() {
  const { uid, projectId } = await myActiveProject()
  if (!uid || !projectId) return { type: 'narrative', title: 'My progress', body: "You're not assigned to a project yet." }
  const [{ data: phaseRows }, { data: pathways }, { data: acts }] = await Promise.all([
    supabase.from('project_phases').select('phase_number, planned_start, planned_end, status').eq('project_id', projectId),
    supabase.from('project_pathways').select('phase_number, content_id').eq('project_id', projectId),
    supabase.from('user_activities').select('content_id, phase_number, status').eq('user_id', uid).eq('status', 'completed'),
  ])
  const pathIds = new Set((pathways ?? []).map(p => p.content_id))
  const today = new Date()
  let overallDone = 0, overallAvail = 0, current = null, overdue = 0
  const rows = PHASES.map(n => {
    const avail = (pathways ?? []).filter(p => p.phase_number === n).length
    const done = (acts ?? []).filter(a => a.phase_number === n && pathIds.has(a.content_id)).length
    overallDone += done; overallAvail += avail
    const pct = avail > 0 ? Math.round((done / avail) * 100) : 0
    const row = (phaseRows ?? []).find(r => r.phase_number === n)
    let status = 'Upcoming'
    if (pct >= 100) status = 'Done'
    else if (row?.planned_start && today >= new Date(row.planned_start)) status = 'In progress'
    if (row?.planned_end && new Date(row.planned_end) < today && pct < 100 && avail > 0) { overdue++; status = 'Overdue' }
    if (status === 'In progress' && !current) current = PHASE_NAMES[n]
    return { label: `${String(n).padStart(2, '0')} ${PHASE_NAMES[n]}`, sub: `${status} · ${done}/${avail}`, value: pct, to: PHASE_PATH[n] }
  })
  const overallPct = overallAvail > 0 ? Math.round((overallDone / overallAvail) * 100) : 0
  const commentary = `You're **${overallPct}%** through your journey${current ? `, currently in **${current}**` : ''}. ` +
    (overdue ? `**${overdue} phase${overdue === 1 ? ' is' : 's are'} overdue** — finishing those steps gets you back on track.` : 'Everything is on schedule.') +
    ' Tap any phase to open it.'
  return { type: 'progress', title: 'My journey — 5 phases', rows, empty: 'No phases set up yet.', commentary }
}

async function runMyReadiness() {
  const { data: { user } } = await supabase.auth.getUser()
  const uid = user?.id
  if (!uid) return { type: 'narrative', title: 'My readiness', body: 'Sign in to see your readiness.' }
  const { data: resps } = await supabase.from('survey_responses').select('survey_id, score, submitted_at').eq('user_id', uid).not('submitted_at', 'is', null)
  const ids = [...new Set((resps ?? []).map(r => r.survey_id).filter(Boolean))]
  let meta = []
  if (ids.length) { const { data } = await supabase.from('surveys').select('id, title, phase_number, rag_green_threshold, rag_amber_threshold').in('id', ids); meta = data ?? [] }
  const scored = (resps ?? []).filter(r => r.score != null)
  const rows = scored.map(r => {
    const s = meta.find(m => m.id === r.survey_id)
    const g = s?.rag_green_threshold ?? 3.5, a = s?.rag_amber_threshold ?? 2.5
    return { rag: r.score >= g ? 'g' : r.score >= a ? 'a' : 'r', name: s?.title ?? 'Survey',
      meta: `${s?.phase_number ? `Phase ${s.phase_number} · ` : ''}${new Date(r.submitted_at).toLocaleDateString('en', { day: 'numeric', month: 'short' })}`,
      due: r.score.toFixed(1) }
  })
  const avg = scored.length ? scored.reduce((s, r) => s + r.score, 0) / scored.length : null
  const ragWord = avg == null ? 'not yet measured' : avg >= 3.5 ? 'On track (Green)' : avg >= 2.5 ? 'At risk (Amber)' : 'Critical (Red)'
  return { type: 'list', title: 'My survey readiness', rows, empty: 'You haven’t submitted any surveys yet.',
    commentary: scored.length ? `Your average readiness is **${avg.toFixed(1)} — ${ragWord}**${rows.length > 1 ? '. Focus on your lowest survey to lift it.' : '.'}` : null }
}

async function runProgress(_params, text, ctx) {
  const data = await loadData()
  const scope = resolveScope(text, ctx, data)
  const cp = scopedProjects(data, scope)
  // Scoped to one project → break down by phase; otherwise list projects.
  const rows = (scope.proj ? cp[0].phases.map(ph => ({ label: ph.name, value: ph.pct, sub: ph.steps ? `${ph.done}/${ph.total} steps` : 'no steps yet' }))
    : cp.map(p => ({ label: p.name, value: p.pct, sub: p.clientName, drill: `Show me the ${p.name} timeline` })))
  if (!scope.proj) rows.sort((a, b) => a.value - b.value)
  const avg = rows.length ? Math.round(rows.reduce((s, r) => s + r.value, 0) / rows.length) : 0
  const drag = rows[0], lead = rows[rows.length - 1]
  return {
    type: 'progress', title: `${scope.proj ? `${scope.proj.name} — progress by phase` : `Progress by project${scope.suffix}`}`, rows,
    empty: 'No projects yet.',
    // With one project there is no spread to describe — naming it as both the drag
    // and the leader reads like a bug, because it is one.
    commentary: rows.length && !scope.proj
      ? (rows.length > 1
          ? `${avg}% average completion across ${rows.length} projects. ${drag.label} (${drag.value}%) is the drag; ${lead.label} (${lead.value}%) leads.`
          : `${drag.label} is at ${drag.value}%. Ask for the story to see trend, risks and what needs a decision.`)
      : null,
  }
}

async function runReadiness(_params, text, ctx) {
  const data = await loadData()
  const scope = resolveScope(text, ctx, data)
  const projRollup = scopedProjects(data, scope)
  const { surveys, today } = data
  const projIds = new Set(projRollup.map(p => p.id))
  const totalDone = projRollup.reduce((s, p) => s + p.done, 0)
  const totalAll = projRollup.reduce((s, p) => s + p.total, 0)
  const pct = totalAll > 0 ? Math.round((totalDone / totalAll) * 100) : 0
  const scoped = scope.label ? surveys.filter(s => s.project_id == null || projIds.has(s.project_id)) : surveys
  const scores = scoped.filter(s => s.score != null)
  const avgScore = scores.length ? scores.reduce((s, r) => s + r.score, 0) / scores.length : null
  const ragLabel = avgScore == null ? 'Not yet measured' : avgScore >= 3.5 ? 'Green — on track' : avgScore >= 2.5 ? 'Amber — at risk' : 'Red — critical'
  const overdue = []
  projRollup.forEach(p => p.phases.forEach(ph => {
    if (ph.planned_end && new Date(ph.planned_end) < today && ph.pct < 100 && ph.steps > 0) overdue.push(ph)
  }))
  return {
    type: 'narrative', title: `Readiness summary${scope.suffix}`,
    body: `Overall readiness is **${ragLabel}**. Average pathway completion is **${pct}%** across ${projRollup.length} project${projRollup.length === 1 ? '' : 's'}` +
      `${scores.length ? `, from ${scores.length} survey response${scores.length === 1 ? '' : 's'}` : ' (no survey responses yet)'}. ` +
      `${overdue.length ? `**${overdue.length}** phase${overdue.length === 1 ? ' is' : 's are'} overdue and under 100% — the biggest lever on the RAG right now.` : 'No phases are currently overdue.'}`,
  }
}

async function runMembersBehind({ phase } = {}, text, ctx) {
  const data = await loadData()
  const { profiles } = data
  const scope = resolveScope(text, ctx, data)
  const projRollup = scopedProjects(data, scope)
  const n = phase ?? detectPhase(text ?? '') ?? 2
  const rows = []
  projRollup.forEach(p => {
    const ph = p.phases.find(x => x.phase_number === n)
    if (!ph || ph.steps === 0) return
    ph.perMember.forEach(mm => {
      if (mm.done < mm.steps) {
        const missing = mm.steps - mm.done
        rows.push({ rag: mm.done === 0 ? 'r' : 'a', name: `${nameOf(profiles, mm.user_id)}${roleOf(profiles, mm.user_id) ? ` · ${roleOf(profiles, mm.user_id)}` : ''}`,
          meta: `${p.name} · ${mm.done}/${mm.steps} steps done`, due: `${missing} left` })
      }
    })
  })
  return {
    type: 'list', title: `Members behind on ${PHASE_NAMES[n]} (Phase ${n})${scope.suffix}`,
    empty: `Everyone is up to date on ${PHASE_NAMES[n]}.`,
    rows: rows.slice(0, 15),
    commentary: rows.length ? `${rows.length} member${rows.length > 1 ? 's have' : ' has'} outstanding ${PHASE_NAMES[n]} steps. Red = not started.` : null,
  }
}

// Detail for a single named client — projects (with current phase), people, completion,
// overdue phases and next milestone. Grounded; mirrors the dashboard's expanded client view.
async function runClientDetail(client, data) {
  const { projRollup, today, surveys } = data
  const cp = projRollup.filter(p => p.client_id === client.id)
  const memberIds = new Set(cp.flatMap(p => p.memberIds))
  const people = memberIds.size
  const cScores = (surveys ?? []).filter(s => memberIds.has(s.user_id) && s.score != null)
  const clientRag = ragOf(cScores.length ? cScores.reduce((s, r) => s + r.score, 0) / cScores.length : null)
  const done = cp.reduce((s, p) => s + p.done, 0)
  const total = cp.reduce((s, p) => s + p.total, 0)
  const pct = total > 0 ? Math.round((done / total) * 100) : 0
  const currentPhase = p => {
    const ph = p.phases.find(x => x.planned_start && x.planned_end && new Date(x.planned_start) <= today && today <= new Date(x.planned_end))
    return ph ? ph.name : (p.phases.every(x => !x.planned_start) ? null : null)
  }
  const rows = cp.map(p => {
    const cur = currentPhase(p)
    const noDates = p.phases.every(x => !x.planned_start)
    return { label: p.name, sub: `${p.members} ${p.members === 1 ? 'person' : 'people'}${cur ? ` · ${cur} underway` : noDates ? ' · no dates yet' : ''}`, value: p.pct, drill: `Show me the ${p.name} timeline` }
  })
  let overdue = 0
  cp.forEach(p => p.phases.forEach(ph => { if (ph.planned_end && new Date(ph.planned_end) < today && ph.pct < 100 && ph.steps > 0) overdue++ }))
  const nextMs = cp.flatMap(p => p.milestones).filter(m => m.milestone_date && new Date(m.milestone_date) >= today)
    .sort((a, b) => new Date(a.milestone_date) - new Date(b.milestone_date))[0]
  // Human narrative first: how many programmes, which are active, people, readiness, then the table.
  const active = cp.filter(p => p.phases.some(x => x.planned_start && new Date(x.planned_start) <= today) || p.pct > 0)
  const idle = cp.filter(p => !active.includes(p))
  const activeBit = cp.length === 0 ? '' :
    active.length === 0 ? ` None have started yet — they're set up but no phase dates or progress are in place.` :
    active.length === cp.length ? ` All ${cp.length} are underway.` :
    ` Of these, ${active.length === 1 ? 'only ' : ''}**${active.map(p => p.name).join('** and **')}** ${active.length === 1 ? 'is' : 'are'} actively progressing${idle.length ? `; **${idle.map(p => p.name).join('** and **')}** ${idle.length === 1 ? "hasn't" : "haven't"} started yet` : ''}.`
  const readyBit = clientRag ? ` Readiness is currently **${RAG_WORD[clientRag]}**.` : ' Readiness has not been measured yet (no survey responses).'
  const intro =
    `**${client.name}** has **${cp.length}** programme${cp.length === 1 ? '' : 's'} set up, run by **${people}** ${people === 1 ? 'person' : 'people'}, at **${pct}%** average completion.${activeBit}${readyBit}` +
    (overdue ? ` ${overdue} phase${overdue === 1 ? ' is' : 's are'} overdue and need attention.` : '') +
    (nextMs ? ` The next milestone is **${nextMs.name}** on ${new Date(nextMs.milestone_date).toLocaleDateString('en', { day: 'numeric', month: 'short' })}.` : '') +
    `\n\nHere's how each programme is tracking:`
  return { type: 'progress', title: client.name, rows, empty: `${client.name} has no projects yet.`, intro }
}

const fmtDate = d => new Date(d).toLocaleDateString('en', { day: 'numeric', month: 'short' })

// Detail for a single project — a human narrative (people, current phase, the change functions in
// each phase) followed by phase-by-phase completion.
async function runProjectDetail(p, data) {
  const { today, profiles } = data
  const memberNames = p.memberIds.map(id => profiles.find(u => u.id === id)?.full_name).filter(Boolean)

  // The change functions (pathway content) configured per phase.
  const { data: pw } = await supabase.from('project_pathways').select('phase_number, content_id').eq('project_id', p.id)
  const cids = [...new Set((pw ?? []).map(r => r.content_id))]
  const { data: cont } = cids.length ? await supabase.from('phase_content').select('id, title').in('id', cids) : { data: [] }
  const titleOf = id => (cont ?? []).find(c => c.id === id)?.title
  const fnByPhase = {}
  ;(pw ?? []).forEach(r => { const t = titleOf(r.content_id); if (t) (fnByPhase[r.phase_number] ??= []).push(t) })

  const rows = p.phases.map(ph => ({ label: ph.name, sub: ph.steps ? `${ph.done}/${ph.total} steps` : 'no steps yet', value: ph.pct }))
  const current = p.phases.find(ph => ph.planned_start && ph.planned_end && new Date(ph.planned_start) <= today && today <= new Date(ph.planned_end))
    || p.phases.find(ph => ph.planned_start && new Date(ph.planned_start) <= today)
  const overdue = p.phases.filter(ph => ph.planned_end && new Date(ph.planned_end) < today && ph.pct < 100 && ph.steps > 0).length
  const nextMs = (p.milestones ?? []).filter(m => m.milestone_date && new Date(m.milestone_date) >= today).sort((a, b) => new Date(a.milestone_date) - new Date(b.milestone_date))[0]

  const withFns = p.phases.filter(ph => (fnByPhase[ph.phase_number] || []).length)
  const withoutFns = p.phases.filter(ph => !(fnByPhase[ph.phase_number] || []).length)
  const curBit = current ? ` It's currently in the **${current.name}** phase.` : ' No phase is active yet — dates haven\'t been set.'
  const peopleBit = memberNames.length ? ` The people working on it are **${memberNames.join('** and **')}**.` : ' No members are assigned yet.'
  let fnBit
  if (withFns.length) {
    fnBit = ' ' + withFns.map(ph => {
      const fns = fnByPhase[ph.phase_number]
      const list = fns.length <= 4 ? fns.join(', ') : `${fns.slice(0, 4).join(', ')} +${fns.length - 4} more`
      return `**${ph.name}** has ${fns.length} change function${fns.length === 1 ? '' : 's'} to complete (${ph.done}/${ph.total} done): ${list}`
    }).join('. ') + '.'
    if (withoutFns.length) fnBit += ` The remaining phase${withoutFns.length === 1 ? '' : 's'} (${withoutFns.map(x => x.name).join(', ')}) ${withoutFns.length === 1 ? "doesn't" : "don't"} have a pathway configured yet.`
  } else {
    fnBit = ' No change functions have been added to the pathway yet, so there\'s nothing for the team to work through so far.'
  }
  const intro =
    `**${p.name}**${p.clientName ? ` (${p.clientName})` : ''} is **${p.pct}%** complete with **${p.members}** ${p.members === 1 ? 'person' : 'people'}.${curBit}${peopleBit}` +
    fnBit +
    (overdue ? ` ${overdue} phase${overdue === 1 ? ' is' : 's are'} overdue.` : '') +
    (nextMs ? ` The next milestone is **${nextMs.name}** on ${fmtDate(nextMs.milestone_date)}.` : '') +
    `\n\nHere's the phase-by-phase progress:`
  return { type: 'progress', title: p.name, rows, empty: 'No phases set up yet.', intro }
}

// Which phase is the question about? "phase 2" or a phase name.
function detectPhase(text) {
  const t = (text ?? '').toLowerCase()
  const m = t.match(/phase\s*([1-5])/)
  if (m) return Number(m[1])
  for (const [n, name] of Object.entries(PHASE_NAMES)) if (t.includes(name.toLowerCase())) return Number(n)
  return null
}

// Drill into one phase of a project: every activity/task/exercise in its pathway, the team who
// own them, and per-activity progress (who's completed each). Grounded, deterministic — no model.
async function runPhaseDetail(p, phaseNumber, data) {
  const { profiles } = data
  const phaseName = PHASE_NAMES[phaseNumber]
  const memberIds = p.memberIds || []

  const { data: pw } = await supabase.from('project_pathways')
    .select('content_id, pathway_step').eq('project_id', p.id).eq('phase_number', phaseNumber).order('pathway_step')
  const cids = (pw ?? []).map(r => r.content_id)
  if (!cids.length) {
    return { type: 'narrative', title: `${p.name} · ${phaseName}`,
      body: `**${phaseName}** in **${p.name}** has no activities configured yet. Set its pathway (Pathway tab) to add the exercises, tools and templates for the team to work through.` }
  }
  const { data: cont } = await supabase.from('phase_content').select('id, title, content_type').in('id', cids)
  const { data: acts } = memberIds.length
    ? await supabase.from('user_activities').select('user_id, content_id, status').in('user_id', memberIds).in('content_id', cids).eq('status', 'completed')
    : { data: [] }

  return buildPhaseDrill({ projectName: p.name, phaseName, orderedContentIds: cids, content: cont ?? [], completions: acts ?? [], memberIds, profiles })
}

// Detail for a person — their projects with their own per-phase completion.
function runPersonDetail(userId, data) {
  const { projRollup, profiles } = data
  const prof = profiles.find(u => u.id === userId)
  const theirs = projRollup.filter(p => p.memberIds.includes(userId))
  const rows = theirs.map(p => {
    let done = 0, steps = 0
    p.phases.forEach(ph => { const mm = ph.perMember.find(x => x.user_id === userId); if (mm) { done += mm.done; steps += mm.steps } })
    return { label: p.name, sub: `${done}/${steps} steps · ${p.clientName}`, value: steps > 0 ? Math.round((done / steps) * 100) : 0, drill: `Show me the ${p.name} timeline` }
  })
  const commentary = `**${prof?.full_name ?? 'Member'}**${prof?.role ? ` · ${prof.role}` : ''} — on ${theirs.length} project${theirs.length === 1 ? '' : 's'}.`
  // "View as member" deep-link (Master-Admin-only; the UI gates rendering by role).
  const action = theirs.length
    ? { label: `View as ${prof?.full_name ?? 'member'} (read-only) →`, to: `/admin/preview?project=${theirs[0].id}&user=${userId}`, adminOnly: true }
    : null
  return { type: 'progress', title: prof?.full_name ?? 'Member', rows, empty: 'Not assigned to any projects.', commentary, action }
}

function runStakeholderDetail(s) {
  return { type: 'narrative', title: s.name, body: `**${s.name}**${s.detail ? ` — ${s.detail}` : ''}. In your stakeholder register.` }
}

// Generic grounded resolver: scan everything captured (clients, projects, people, stakeholders)
// for a name mentioned in the question, and return that record's detail. Prefers the longest
// (most specific) name match. This is what lets "any detail we have" be answered by the rules.
async function resolveEntity(text, ctx = {}) {
  const t = (text ?? '').toLowerCase()
  const [data, { data: stakeholders }] = await Promise.all([
    loadData(),
    supabase.from('stakeholders').select('id, name, detail').eq('is_active', true),
  ])
  const candidates = []
  data.clients.forEach(c => c.name && candidates.push({ type: 'client', id: c.id, name: c.name }))
  data.projRollup.forEach(p => p.name && candidates.push({ type: 'project', id: p.id, name: p.name }))
  data.profiles.forEach(u => u.full_name && candidates.push({ type: 'person', id: u.id, name: u.full_name }))
  ;(stakeholders ?? []).forEach(s => s.name && candidates.push({ type: 'stakeholder', id: s.id, name: s.name, detail: s.detail }))

  const matches = candidates.filter(c => c.name.length >= 3 && t.includes(c.name.toLowerCase()))
    .sort((a, b) => b.name.length - a.name.length)   // most specific wins
  // Fall back to the conversation's remembered entity when the sentence names none
  // (e.g. "give me more details under Diagnose" after we were just discussing RSR Program).
  let m = matches[0]
  if (!m && ctx.entity) {
    const e = String(ctx.entity).toLowerCase()
    m = candidates.filter(c => c.name.length >= 3 && e.includes(c.name.toLowerCase())).sort((a, b) => b.name.length - a.name.length)[0]
  }
  if (!m) return null

  // "timeline / schedule / roadmap / gantt" → render the actual timeline (delivery + change
  // lanes + phases) rather than a progress list. Client → all its projects' timelines.
  const wantsTimeline = /(timeline|schedule|roadmap|gantt)/i.test(text)
  if (wantsTimeline && (m.type === 'client' || m.type === 'project')) {
    const projects = m.type === 'project'
      ? [{ id: m.id, name: m.name }]
      : data.projRollup.filter(p => p.client_id === m.id).map(p => ({ id: p.id, name: p.name }))
    return { type: 'timeline', descriptor: { type: 'projectTimeline', title: `${m.name} — timeline${projects.length === 1 ? '' : 's'}`, projects } }
  }

  // Phase drill: "check under Diagnose", "what's in the Design phase" → that phase's activities,
  // owners and per-activity progress for the resolved project (or the client's active project).
  const phaseNum = detectPhase(text)
  if (phaseNum && (m.type === 'project' || m.type === 'client')) {
    const proj = m.type === 'project'
      ? data.projRollup.find(p => p.id === m.id)
      : (data.projRollup.filter(p => p.client_id === m.id).find(p => p.memberIds.length) || data.projRollup.find(p => p.client_id === m.id))
    if (proj) return { type: 'project', descriptor: await runPhaseDetail(proj, phaseNum, data) }
  }

  let descriptor
  if (m.type === 'client')      descriptor = await runClientDetail(data.clients.find(c => c.id === m.id), data)
  else if (m.type === 'project')     descriptor = await runProjectDetail(data.projRollup.find(p => p.id === m.id), data)
  else if (m.type === 'person')      descriptor = runPersonDetail(m.id, data)
  else                               descriptor = runStakeholderDetail(m)
  return { type: m.type, descriptor }
}

// ── Approach drafts ──────────────────────────────────────────────────────────────
// "Define the comms approach" is advisory, not retrieval — the answer doesn't exist in the data
// yet. Rather than let a model invent generic consulting boilerplate, CORA drafts it FROM the
// client's real picture: impacted groups (heat map), phase dates, milestones and named owners.
// Deterministic, grounded, $0. The admin edits from there.
async function runApproach(_params, text, ctx) {
  const data = await loadData()
  const scope = resolveScope(text, ctx, data)
  const cp = scopedProjects(data, scope)

  // Load the knowledge base up-front: it decides both WHICH subject this is and what to say.
  let allRules = []
  try {
    const { data: rows } = await supabase.from('ai_knowledge')
      .select('id, topic, title, body, gaps, triggers, client_id, industry, source, status')
      .eq('status', 'active')
    allRules = rows ?? []
  } catch { /* best effort */ }

  const matched = matchKnowledgeRule(text, allRules)
  const topic = { key: matched?.topic ?? 'comms', label: matched?.title ?? 'Approach' }

  // Which client are we drafting for?
  let client = scope.client
  if (!client && scope.proj) client = data.clients.find(c => c.id === scope.proj.client_id) ?? null
  // Fall back to whoever the conversation has been about — the remembered entity may be a project,
  // or only appear in an earlier turn ("Show me Horizon Power" → "Define Training Approach").
  if (!client && ctx?.history?.length) {
    const hay = ctx.history.map(h => `${h.q ?? ''} ${h.a ?? ''}`).join(' ').toLowerCase()
    const proj = data.projRollup.find(p => p.name && p.name.length >= 3 && hay.includes(p.name.toLowerCase()))
    client = (proj ? data.clients.find(c => c.id === proj.client_id) : null)
      ?? data.clients.find(c => c.name && c.name.length >= 3 && hay.includes(c.name.toLowerCase())) ?? null
  }
  if (!client && data.clients.length === 1) client = data.clients[0]
  if (!client) {
    // Never dead-end: offer the clients as one-click choices rather than asking them to retype.
    return { type: 'list', title: 'Which client?',
      intro: `I can draft the ${topic.label.toLowerCase()} from a client's live data — pick one:`,
      empty: 'No clients set up yet.',
      rows: (data.clients ?? []).map(c => ({ rag: 'g', name: c.name, meta: 'Draft from their data', drill: `${topic.label} for ${c.name}` })) }
  }
  const projects = cp.filter(p => p.client_id === client.id)
  const scopeLabel = scope.proj ? `${client.name} — ${scope.proj.name}` : client.name

  // Impacted groups, ranked (the audience for every one of these approaches).
  let groups = []
  const { data: arts } = await supabase.from('change_artifacts').select('data')
    .eq('client_id', client.id).eq('type', 'stakeholder_heatmap').eq('is_current', true)
    .order('version', { ascending: false }).limit(1)
  if (arts?.[0]?.data?.rows) {
    groups = arts[0].data.rows.map(r => {
      const cells = r.cells ?? []
      return { name: r.label, total: cells.reduce((s, lv) => s + (LV_W[lv] || 0), 0), peak: cells.reduce((m, lv) => ((LV_W[lv] || 0) > (LV_W[m] || 0) ? lv : m), 'none') }
    }).sort((a, b) => b.total - a.total)
  }
  const top = groups.slice(0, 3)
  const audienceLine = groups.length
    ? top.map(g => `${g.name} (${LV_LABEL[g.peak]})`).join(', ')
    : 'no stakeholder heat map captured yet — load one and I\'ll target this properly'

  // Timeline + owners from the live plan.
  const allPhases = projects.flatMap(p => p.phases.map(ph => ({ ...ph, project: p.name })))
  const phaseOn = n => allPhases.filter(ph => ph.phase_number === n).map(ph => ph.planned_start ? fmtDate(ph.planned_start) : null).filter(Boolean)[0] ?? 'date TBC'
  const owners = [...new Set(projects.flatMap(p => p.memberIds))].map(id => nameOf(data.profiles, id)).filter(Boolean)
  const ownerLine = owners.length ? owners.slice(0, 6).join(', ') + (owners.length > 6 ? ` +${owners.length - 6} more` : '') : 'no members assigned yet'
  const ms = projects.flatMap(p => (p.milestones ?? []).filter(m => m.milestone_date).map(m => ({ ...m, project: p.name })))
    .sort((a, b) => new Date(a.milestone_date) - new Date(b.milestone_date)).slice(0, 4)
  const msLine = ms.length ? ms.map(m => `${m.name} (${fmtDate(m.milestone_date)})`).join(', ') : 'no milestones set yet'

  const head = `**${topic.label} — ${scopeLabel}**\nA structural starting point shaped by what ChangeFlow holds today. Read the "What this is based on" note at the end before sharing it — some of this is scaffolding, not evidence.\n`

  // ── Practice-source ladder ──
  // Where does the *discipline* guidance come from? Prefer YOUR curated Content library (it's your
  // IP, editable by Master Admin without a deploy), then the on-device model, then built-in
  // convention as a last resort. Whichever tier answers is named in the honesty note below.
  // Tokens the knowledge rule can interpolate from this client's live picture.
  const tokens = {
    client: client.name,
    scope: scopeLabel,
    projects: projects.map(p => p.name).join(', ') || 'no programmes yet',
    audiences: audienceLine,
    owners: ownerLine,
    milestones: msLine,
    groupcount: String(groups.length || 0),
    phase1: phaseOn(1), phase2: phaseOn(2), phase3: phaseOn(3), phase4: phaseOn(4), phase5: phaseOn(5),
  }

  // Rule lookup: client-specific → industry → global. Whichever wins is rendered with live data.
  // Same topic, most specific scope wins: this client's rule > their industry's > the global one.
  let practice = null, practiceSource = 'none', ruleTitle = null, ruleGaps = null
  const sameTopic = allRules.filter(r => r.topic === topic.key)
  const pick = sameTopic.sort((a, b) => {
    const rank = r => (r.client_id === client.id ? 0 : r.industry && r.industry === client.industry ? 1 : !r.client_id && !r.industry ? 2 : 3)
    return rank(a) - rank(b)
  })[0]
  if (pick) {
    practice = renderTemplate(pick.body, tokens)
    practiceSource = pick.source === 'slm' ? 'slm_rule' : pick.client_id ? 'rule_client' : pick.industry ? 'rule_industry' : 'rule_global'
    ruleTitle = pick.title
    ruleGaps = pick.gaps
  }

  // No rule yet → ask the on-device model, then WRITE IT BACK so the next ask is instant.
  if (!practice && await slmAvailable()) {
    try {
      const out = await slmGenerate(
        'You are CORA, a change-management assistant. Give practical, specific guidance. Use short numbered sections with bold headings. No preamble, no generic filler.',
        `Draft ${topic.label} guidance. Impacted groups: {{audiences}}. Programmes: {{projects}}. Team: {{owners}}. Key dates: {{milestones}}. Write it as a reusable template that keeps those {{tokens}} in place so it can be reused for other clients.`,
        null, { maxTokens: 420 })
      if (out && out.trim()) {
        practice = renderTemplate(out.trim(), tokens)
        practiceSource = 'slm_new'
        // Enrich the rule store (admin-only by RLS; silently skipped for other roles). Triggers are
        // derived from the question so the new rule is findable next time without a code change.
        const trigs = [...new Set(distinctiveTokens(text ?? '').filter(w => w.length >= 4))].slice(0, 6)
        supabase.from('ai_knowledge').insert({
          topic: topic.key || (trigs[0] ?? 'general'), title: topic.label, body: out.trim(),
          triggers: trigs.length ? trigs : null, source: 'slm', status: 'draft',
        }).then(() => {}, () => {})
      }
    } catch { /* leave practice null — the honesty note explains */ }
  }

  // The client's industry may carry the methodology your practice is built on.
  let methodology = null
  try {
    if (client.industry) {
      const { data: ind } = await supabase.from('industries').select('label, detail').eq('code', client.industry).limit(1)
      if (ind?.[0]) methodology = `${ind[0].label}${ind[0].detail ? ` — ${ind[0].detail}` : ''}`
    }
  } catch { /* optional */ }


  // ── Be explicit about evidence vs. scaffolding ──
  // The client/project/phase data is real. The discipline content (how to train, how to cut over)
  // is generic practice — ChangeFlow doesn't hold a training needs analysis or a cutover runbook.
  // Say so plainly, and name what to capture, rather than letting structure imply substance.
  const { data: artRows } = await supabase.from('change_artifacts').select('type')
    .eq('client_id', client.id).eq('is_current', true)
  const haveTypes = [...new Set((artRows ?? []).map(a => a.type))]
  const datedPhases = allPhases.filter(ph => ph.planned_start).length
  const scored = (data.surveys ?? []).filter(s => new Set(projects.flatMap(p => p.memberIds)).has(s.user_id) && s.score != null)

  const basis = [
    `${projects.length} programme${projects.length === 1 ? '' : 's'} for ${client.name}`,
    datedPhases ? `${datedPhases} phase${datedPhases === 1 ? '' : 's'} with planned dates` : null,
    owners.length ? `${owners.length} assigned team member${owners.length === 1 ? '' : 's'}` : null,
    groups.length ? `a stakeholder heat map (${groups.length} groups)` : null,
    ms.length ? `${ms.length} milestone${ms.length === 1 ? '' : 's'}` : null,
    scored.length ? `${scored.length} readiness survey response${scored.length === 1 ? '' : 's'}` : null,
  ].filter(Boolean)

  // Gaps come from the rule itself, so each subject declares what ChangeFlow doesn't hold for it.
  const missing = (ruleGaps && ruleGaps.length) ? ruleGaps
    : ['structured detail for this subject — no gaps are recorded on the rule yet']

  const disc = topic.label.replace(' Approach', '').toLowerCase()
  const sourceNote = {
    rule_client: `The guidance above is **your own rule for ${client.name}** — curated in CORA's knowledge base, filled with this programme's live data.`,
    rule_industry: `The guidance above is **your rule for the ${client.industry} industry**, filled with this programme's live data.`,
    rule_global: `The guidance above is **your platform-wide ${disc} rule**, filled with this programme's live data. Refine it once and every client benefits.`,
    slm_rule: `The guidance above came from a rule the **on-device model drafted earlier** and it is still marked draft — review and curate it so it becomes trusted practice.`,
    slm_new: `No ${disc} rule existed, so the **on-device model drafted one just now** and I've saved it as a draft rule for review. The next ask will be instant. Treat this pass as a prompt to react to, not doctrine.`,
    none: `No ${disc} rule exists yet and no on-device model is available, so I have **no practice guidance to offer** — only the grounded facts below. Add a rule and I'll serve it instantly next time.`,
  }[practiceSource]

  const honesty =
    `**What this is based on**\nReal data I hold: ${basis.join('; ')}.` +
    (haveTypes.length ? ` Captured artifacts: ${haveTypes.join(', ')}.` : '') +
    (methodology ? ` Industry methodology on record: ${methodology}.` : '') +
    `\n\n${sourceNote}` +
    `\n\nWhat I do **not** hold for ${disc}: ${missing.join('; ')}. ` +
    `The audiences, dates, owners and milestones woven through this are drawn from your data and are specific to ${client.name} — those you can rely on.`

  // Grounded facts always accompany the guidance, so the reader can separate the two.
  const facts = `**Programme facts used**\n• Audiences: ${audienceLine}\n• Programmes: ${tokens.projects}\n• Owners: ${ownerLine}\n• Milestones: ${msLine}\n• Phase starts: Diagnose ${tokens.phase1}, Design ${tokens.phase2}, Engage ${tokens.phase3}, Embed ${tokens.phase4}, Evaluate ${tokens.phase5}`

  const parts = [head]
  if (practice) parts.push(ruleTitle && practiceSource.startsWith('rule') ? `**${ruleTitle}**\n${practice}` : practice)
  parts.push(facts, honesty)
  return { type: 'narrative', title: `${topic.label} — ${scopeLabel}`, body: parts.join('\n\n') }
}


// ── Readiness gate ────────────────────────────────────────────────────────────
// A unit that has not been assessed is reported as not assessed, never as ready,
// and is excluded from the ready count. An unanswered gate is not a passed one.
async function runGates(_params, text, ctx) {
  const data = await loadData()
  const scope = resolveScope(text, ctx, data)
  const clientId = scope.client?.id ?? (scope.proj ? data.projRollup.find(p => p.id === scope.proj.id)?.client_id : null)
  let q = supabase.from('change_artifacts').select('client_id, title, data').eq('type', 'readiness_gate').eq('is_current', true)
  if (clientId) q = q.eq('client_id', clientId)
  const { data: arts } = await q
  const art = (arts ?? [])[0]
  if (!art) {
    return { type: 'narrative', title: 'No readiness gate yet',
      body: `No business readiness gate has been captured${scope.label ? ` for **${scope.label}**` : ''} yet.` }
  }
  const g = art.data ?? {}
  const units = g.units ?? []
  // 'n' = not assessed. Deliberately not amber: amber says "nearly there",
  // and the truth is that nobody has looked at it yet.
  const RAG = { ready: 'g', watch: 'a', at_risk: 'r', not_assessed: 'n' }
  const WORD = { ready: 'Ready', watch: 'Watch', at_risk: 'At risk', not_assessed: 'Not assessed' }
  const rows = units.map(u => ({
    rag: RAG[u.status] ?? 'a',
    name: u.unit,
    meta: `${u.met}/${u.total} criteria · ${WORD[u.status] ?? u.status}${u.owner ? ` · ${u.owner}` : ' · unassigned'}`,
    due: u.open ?? '',
  }))
  const ready = units.filter(u => u.status === 'ready').length
  const met = units.reduce((s, u) => s + (u.met ?? 0), 0)
  const total = units.reduce((s, u) => s + (u.total ?? 0), 0)
  const unassessed = units.filter(u => u.status === 'not_assessed')
  const commentary = [
    `**${met}/${total}** criteria met; **${ready}/${units.length}** units ready.`,
    g.decision_due ? `Decision due ${new Date(g.decision_due + 'T00:00:00').toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}${g.owner ? `, owned by ${g.owner}` : ''}.` : null,
    unassessed.length ? `${unassessed.map(u => u.unit).join(', ')} ${unassessed.length === 1 ? 'has' : 'have'} not been assessed and ${unassessed.length === 1 ? 'is' : 'are'} not counted as ready.` : null,
  ].filter(Boolean).join(' ')
  return { type: 'list', title: `${g.gate_name ?? art.title}${scope.suffix}`, rows, commentary, empty: 'No units on this gate.' }
}

// ── Comms plan ────────────────────────────────────────────────────────────────
// Blocked is distinct from late: a comm can be on time and still unsendable because
// the phase output it draws its audience from is unfinished. Saying only "overdue"
// points at the wrong person.
async function runComms(_params, text, ctx) {
  const data = await loadData()
  const scope = resolveScope(text, ctx, data)
  const clientId = scope.client?.id ?? (scope.proj ? data.projRollup.find(p => p.id === scope.proj.id)?.client_id : null)
  let q = supabase.from('change_artifacts').select('client_id, title, data').eq('type', 'comms_plan').eq('is_current', true)
  if (clientId) q = q.eq('client_id', clientId)
  const { data: arts } = await q
  const art = (arts ?? [])[0]
  if (!art) {
    return { type: 'narrative', title: 'No comms plan yet',
      body: `No comms plan has been captured${scope.label ? ` for **${scope.label}**` : ''} yet.` }
  }
  const c = art.data ?? {}
  const items = c.items ?? []
  const RAG = { sent: 'g', planned: 'a', blocked: 'r', overdue: 'r', deferred: 'a' }
  const fmt = d => d ? new Date(d + 'T00:00:00').toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) : '—'
  const rows = items.map(i => ({
    rag: RAG[i.status] ?? 'a',
    name: i.message,
    meta: `${i.audience}${i.size ? ` · ${i.size}` : ''} · ${i.channel}${i.owner ? ` · ${i.owner}` : ' · no owner'}`,
    due: `${fmt(i.date)}${i.status === 'blocked' ? ' · blocked' : i.status === 'overdue' ? ' · overdue' : i.status === 'deferred' ? ' · deferred' : ''}`,
  }))
  const sent = items.filter(i => i.status === 'sent').length
  const blocked = items.filter(i => i.status === 'blocked')
  const overdue = items.filter(i => i.status === 'overdue')
  const deferred = items.filter(i => i.status === 'deferred')
  const commentary = [
    `**${sent}/${items.length}** sent, anchored to ${c.anchor ?? 'the timeline'}${c.anchor_date ? ` (${fmt(c.anchor_date)})` : ''}.`,
    overdue.length ? `**${overdue.length} overdue** — the date has passed and nothing went out.` : null,
    blocked.length ? `**${blocked.length} blocked**: ${blocked.map(b => `${b.message} — ${b.source}`).join('; ')}. Blocked is not the same as late; the upstream output is what needs finishing.` : null,
    deferred.length ? `${deferred.length} deferred by decision, not by slippage.` : null,
  ].filter(Boolean).join(' ')
  return { type: 'list', title: `${art.title}${scope.suffix}`, rows, commentary, empty: 'No comms planned.' }
}


// ── Programme story ───────────────────────────────────────────────────────────
// The update a change lead would give out loud: where we are, which way it is
// moving, what is in the way, who it lands on, are we ready, what needs deciding.
// Everything is read from data already captured; nothing is invented, and missing
// inputs are named at the end rather than skipped over.
async function runStory(_params, text, ctx) {
  const data = await loadData()
  const scope = resolveScope(text, ctx, data)
  const cp = scopedProjects(data, scope)
  if (!cp.length) return { type: 'narrative', title: 'No project in scope', body: 'Name a client or project and I will pull the update together.' }

  // One project tells a story; a portfolio needs picking one.
  const p = scope.proj ? cp[0] : cp.slice().sort((a, b) => b.pct - a.pct)[0]
  const clientId = p.clientId ?? data.projRollup.find(x => x.id === p.id)?.client_id

  const [{ data: arts }, { data: snaps }] = await Promise.all([
    supabase.from('change_artifacts').select('type, data').eq('client_id', clientId).eq('is_current', true),
    supabase.from('progress_snapshots').select('captured_on, pct').eq('project_id', p.id).order('captured_on'),
  ])
  const art = t => (arts ?? []).find(a => a.type === t)?.data ?? null

  const today = data.today
  const pEnds = p.phases.map(ph => ph.planned_end).filter(Boolean).sort()
  const trend = computeTrend((snaps ?? []).map(x => ({ captured_on: x.captured_on, pct: Number(x.pct) })),
    { plannedEnd: pEnds.length ? pEnds[pEnds.length - 1] : null, today })

  const atRisk = p.phases.filter(ph => ph.planned_end && new Date(ph.planned_end) < today && ph.pct < 100 && ph.steps > 0)
    .map(ph => ({ name: ph.name, pct: ph.pct }))
  const soon = new Date(today); soon.setDate(soon.getDate() + 60)
  const milestones = (data.milestones ?? [])
    .filter(m => m.project_id === p.id && m.milestone_date && new Date(m.milestone_date) >= today && new Date(m.milestone_date) <= soon)
    .sort((a, b) => a.milestone_date.localeCompare(b.milestone_date))
    .map(m => ({ name: m.name, date: m.milestone_date }))

  const story = buildProgrammeStory({
    projectName: p.name, clientName: p.clientName, today,
    pct: p.pct, phases: p.phases.map(ph => ({ name: ph.name, pct: ph.pct })),
    trend, milestones, atRisk,
    plannedEnd: pEnds.length ? pEnds[pEnds.length - 1] : null,
    heat: art('stakeholder_heatmap'), gate: art('readiness_gate'),
    comms: art('comms_plan'), issues: art('issues_log'),
  })

  // Prose AND the real widgets, interleaved. Describing a heat map in words when the
  // grid itself is one line away is the thing that made this feel thin.
  const heat = art('stakeholder_heatmap')
  const gate = art('readiness_gate')
  const comms = art('comms_plan')
  const byHeading = h => story.sections.find(x => x.heading === h)?.body ?? null

  const RAG_GATE = { ready: 'g', watch: 'a', at_risk: 'r', not_assessed: 'n' }
  const RAG_COMM = { sent: 'g', planned: 'a', blocked: 'r', overdue: 'r', deferred: 'a' }
  const fmtD = dd => dd ? new Date(dd + 'T00:00:00').toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) : '—'

  const blocks = [
    { heading: 'Where we are', prose: byHeading('Where we are'),
      widget: { type: 'progress', rows: p.phases.map(ph => ({ label: ph.name, value: ph.pct, sub: ph.steps ? `${ph.done}/${ph.total} steps` : 'no steps yet' })) } },

    { heading: 'Which way it is moving', prose: byHeading('Which way it is moving'),
      widget: (snaps ?? []).length >= 2
        ? { type: 'trend', chart: buildTrendChart([{ name: p.name, points: (snaps ?? []).map(x => ({ captured_on: x.captured_on, pct: Number(x.pct) })) }],
            { plannedEnd: pEnds.length ? pEnds[pEnds.length - 1] : null, today }), verdict: trendSentence(trend, fmtDate) }   // 2nd arg is a date formatter, not a name
        : null },

    { heading: 'What is in the way', prose: byHeading('What is in the way'),
      widget: comms?.items?.some(i => i.status === 'blocked' || i.status === 'overdue')
        ? { type: 'list', rows: comms.items.filter(i => i.status === 'blocked' || i.status === 'overdue')
            .map(i => ({ rag: RAG_COMM[i.status] ?? 'r', name: i.message, meta: `${i.audience} · ${i.channel}${i.owner ? ` · ${i.owner}` : ' · no owner'}`, due: `${fmtD(i.date)} · ${i.status}` })) }
        : null },

    { heading: 'Who it lands on', prose: byHeading('Who it lands on'),
      widget: heat?.rows?.length ? { type: 'heatmap', cols: heat.cols, rows: heat.rows } : null },

    { heading: 'Are we ready', prose: byHeading('Are we ready'),
      widget: gate?.units?.length
        ? { type: 'list', rows: gate.units.map(u => ({ rag: RAG_GATE[u.status] ?? 'a', name: u.unit,
            meta: `${u.met}/${u.total} criteria${u.owner ? ` · ${u.owner}` : ' · unassigned'}`, due: u.open ?? '' })) }
        : null },

    { heading: 'What needs a decision', prose: byHeading('What needs a decision'), widget: null },
  ].filter(b => b.prose || b.widget)

  return { type: 'story', title: story.title, subtitle: story.subtitle, blocks, gaps: story.gaps }
}

const RUNNERS = {
  story: runStory,
  report: runReport,
  approach: runApproach,
  heatmap: runHeatmap,
  gates: runGates,
  comms: runComms,
  my_progress: runMyJourney,
  my_readiness: runMyReadiness,
  clients: runClients,
  people: runPeople,
  members_behind: runMembersBehind,
  at_risk: runAtRisk,
  milestones: runMilestones,
  upcoming: runUpcoming,
  progress: runProgress,
  readiness: runReadiness,
}

// ── Phrase learning (silent, self-correcting) ────────────────────────────────────
// The framework adapts behind the scenes: when a phrasing misses and the user rephrases to
// something that works on the same topic, we remember the missed phrasing → that intent,
// entity-stripped so it generalises. No commands, no UI — it just gets better with use.

let _phraseCache = null
async function loadLearnedPhrases() {
  if (_phraseCache) return _phraseCache
  const { data } = await supabase.from('ai_intent_phrases').select('phrase_norm, intent')
  _phraseCache = (data ?? []).map(p => ({ intent: p.intent, toks: (p.phrase_norm || '').split(' ').filter(Boolean) }))
    .filter(p => p.toks.length >= 2 && RUNNERS[p.intent])
  return _phraseCache
}

async function learnPhrase(missText, intent, entityNames, userId) {
  const toks = distinctiveTokens(missText, entityNames)
  if (toks.length < 2 || !RUNNERS[intent]) return   // too generic to learn safely
  await supabase.from('ai_intent_phrases')
    .upsert({ phrase: missText, phrase_norm: toks.join(' '), intent, created_by: userId ?? null }, { onConflict: 'phrase_norm' })
  _phraseCache = null
}

// Called by the UI when a missed query is followed by a successful, same-topic rephrase.
export async function noteCorrection(missText, matchedText, intent, userId) {
  if (!missText || !matchedText || !RUNNERS[intent]) return
  const a = distinctiveTokens(missText), b = new Set(distinctiveTokens(matchedText))
  if (!a.some(w => b.has(w))) return   // different topic — don't mis-learn
  const [{ data: cs }, { data: ps }, { data: us }] = await Promise.all([
    supabase.from('clients').select('name'),
    supabase.from('projects').select('name'),
    supabase.from('profiles').select('full_name'),
  ])
  const names = [...(cs ?? []).map(x => x.name), ...(ps ?? []).map(x => x.name), ...(us ?? []).map(x => x.full_name)].filter(Boolean)
  await learnPhrase(missText, intent, names, userId)
}

// Public: try to answer with rules. Returns { matched, intent, descriptor } — descriptor is
// null when no rule matched (router then escalates to the SLM).
// A misspelt client or project name would otherwise be answered silently across the
// whole portfolio, which looks like a correct answer to a question you didn't ask.
// Every intent runner scopes through resolveScope, so the check belongs here — once,
// at the choke point — rather than repeated in each of them.
async function withDidYouMean(descriptor, text, ctx) {
  if (!descriptor) return descriptor
  try {
    const data = await loadData()
    const { didYouMean, ambiguous } = resolveScope(text, ctx, data)
    if (ambiguous?.length) {
      const names = ambiguous.map(a => a.name)
      const note = `That name matches ${names.length} records (${names.join(', ')}). This answer covers all of them — name the client to narrow it.`
      return { ...descriptor, ambiguous, commentary: descriptor.commentary ? `${note}\n\n${descriptor.commentary}` : note }
    }
    if (!didYouMean) return descriptor
    const note = `I couldn't find “${didYouMean.typed}”. Did you mean **${didYouMean.name}**? This answer covers everything until you confirm.`
    return { ...descriptor, didYouMean, commentary: descriptor.commentary ? `${note}\n\n${descriptor.commentary}` : note }
  } catch {
    return descriptor      // a suggestion is a nicety; never fail the answer over it
  }
}

export async function runRules(text, ctx = {}) {
  // 1 ── Deterministic intent match
  const hit = matchIntent(text)
  if (hit) {
    const descriptor = await withDidYouMean(await RUNNERS[hit.intent](hit.params, text, ctx), text, ctx)
    return { matched: true, intent: hit.intent, descriptor }
  }

  // 2 ── Learned phrasing: all distinctive tokens of a learned phrase present in the query.
  const learned = await loadLearnedPhrases()
  if (learned.length) {
    const q = new Set(distinctiveTokens(text))
    const lp = learned.find(p => p.toks.every(t => q.has(t)))
    if (lp) {
      const descriptor = await withDidYouMean(await RUNNERS[lp.intent](null, text, ctx), text, ctx)
      return { matched: true, intent: lp.intent, learned: true, descriptor }
    }
  }

  // 3 ── Generic grounded fallback: does the question name a client, project, person or
  // stakeholder? (Falls back to the conversation's remembered entity for phrase-less follow-ups.)
  const resolved = await resolveEntity(text, ctx)
  if (resolved) return { matched: true, intent: `detail_${resolved.type}`, descriptor: resolved.descriptor }
  return { matched: false, intent: null, descriptor: null }
}

// Assemble a compact, grounded snapshot of the client's whole picture — projects, phases (status,
// dates, progress), overdue risks, upcoming milestones, readiness, and the stakeholder heat map.
// This is the context CORA reasons over for open, conversational questions. RLS-scoped.
export async function assembleClientContext(entityHint) {
  const data = await loadData()
  const today = data.today
  const focus = entityHint ? data.clients.find(c => c.name && String(entityHint).toLowerCase().includes(c.name.toLowerCase())) : null
  const cid = focus?.id
  const cps = data.projRollup.filter(p => !cid || p.client_id === cid)
  const lines = [`Client: ${focus?.name || data.projRollup?.[0]?.clientName || 'your programme'} (as of ${fmtDate(today)})`]

  cps.forEach(p => {
    lines.push(`Project "${p.name}": ${p.members} ${p.members === 1 ? 'person' : 'people'}, ${p.pct}% complete.`)
    p.phases.forEach(ph => {
      const started = ph.planned_start && new Date(ph.planned_start) <= today
      const state = ph.pct >= 100 ? 'done' : started ? 'in progress' : 'upcoming'
      const overdue = ph.planned_end && new Date(ph.planned_end) < today && ph.pct < 100 ? ' — OVERDUE' : ''
      const dates = ph.planned_start ? ` [${fmtDate(ph.planned_start)}→${ph.planned_end ? fmtDate(ph.planned_end) : '?'}]` : ''
      lines.push(`  • Phase ${ph.phase_number} ${ph.name}: ${ph.pct}% (${state}${overdue})${dates}`)
    })
    ;(p.milestones || []).filter(m => m.milestone_date).forEach(m => lines.push(`  • Milestone: ${m.name} — ${fmtDate(m.milestone_date)}`))
  })

  const memberIds = new Set(cps.flatMap(p => p.memberIds))
  const scores = data.surveys.filter(s => memberIds.has(s.user_id) && s.score != null)
  const avg = scores.length ? scores.reduce((s, r) => s + r.score, 0) / scores.length : null
  lines.push(`Readiness: ${avg == null ? 'not yet measured (no survey responses)' : `${avg.toFixed(1)}/5 — ${avg >= 3.5 ? 'Green/on track' : avg >= 2.5 ? 'Amber/at risk' : 'Red/critical'} from ${scores.length} response${scores.length === 1 ? '' : 's'}`}.`)

  const overdue = []
  cps.forEach(p => p.phases.forEach(ph => { if (ph.planned_end && new Date(ph.planned_end) < today && ph.pct < 100 && ph.steps > 0) overdue.push(`${ph.name} · ${p.name} (${ph.pct}%)`) }))
  lines.push(overdue.length ? `Overdue/at-risk phases: ${overdue.join('; ')}.` : 'No phases are currently overdue.')

  if (cid) {
    const { data: arts } = await supabase.from('change_artifacts').select('data').eq('client_id', cid).eq('type', 'stakeholder_heatmap').eq('is_current', true).order('version', { ascending: false }).limit(1)
    if (arts?.[0]?.data?.commentary) lines.push(`Stakeholder impact: ${String(arts[0].data.commentary).replace(/\*\*/g, '')}`)
  }
  return lines.join('\n')
}

// Lightweight summary for the collapsed KPI chips (one grounded load).
export async function loadSummary() {
  const { projRollup, surveys, today } = await loadData()
  const totalDone = projRollup.reduce((s, p) => s + p.done, 0)
  const totalAll = projRollup.reduce((s, p) => s + p.total, 0)
  const pct = totalAll > 0 ? Math.round((totalDone / totalAll) * 100) : 0
  let atRisk = 0
  projRollup.forEach(p => p.phases.forEach(ph => {
    if (ph.planned_end && new Date(ph.planned_end) < today && ph.pct < 100 && ph.steps > 0) atRisk++
  }))
  const soon = new Date(today); soon.setDate(soon.getDate() + 7)
  const dueSoon = projRollup.reduce((s, p) => s + p.milestones.filter(m => m.milestone_date && new Date(m.milestone_date) >= today && new Date(m.milestone_date) <= soon).length, 0)
  const scores = surveys.filter(s => s.score != null)
  const avg = scores.length ? scores.reduce((s, r) => s + r.score, 0) / scores.length : null
  const rag = avg == null ? '—' : avg >= 3.5 ? 'Green' : avg >= 2.5 ? 'Amber' : 'Red'
  return { pct, atRisk, dueSoon, rag, projects: projRollup.length }
}
