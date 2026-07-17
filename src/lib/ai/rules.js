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

  return { today, clients: clients ?? [], projRollup, milestones, surveys, profiles, clientName }
}

const nameOf = (profiles, id) => profiles.find(p => p.id === id)?.full_name ?? 'Member'
const roleOf = (profiles, id) => profiles.find(p => p.id === id)?.role ?? null

// ── Intent runners → widget descriptors ───────────────────────────────────────
async function runAtRisk() {
  const { projRollup, today } = await loadData()
  const rows = []
  projRollup.forEach(p => p.phases.forEach(ph => {
    if (ph.planned_end && new Date(ph.planned_end) < today && ph.pct < 100 && ph.steps > 0)
      rows.push({ rag: ph.pct < 40 ? 'r' : 'a', name: `${ph.name} · ${ph.project ?? p.name}`,
        meta: `${p.clientName} · ${ph.pct}% complete`, due: 'overdue' })
  }))
  return {
    type: 'list', title: 'At-risk items', empty: 'Nothing overdue — everything on track.',
    rows: rows.slice(0, 12),
    commentary: rows.length ? `${rows.length} phase${rows.length > 1 ? 's are' : ' is'} past its planned end date and under 100%. The red items are below 40% — those need attention first.` : null,
  }
}

async function runMilestones() {
  const { milestones, projRollup, today } = await loadData()
  const projName = id => projRollup.find(p => p.id === id)?.name ?? 'Project'
  const soon = new Date(today); soon.setDate(soon.getDate() + 7)
  const rows = (milestones ?? [])
    .filter(m => m.milestone_date && new Date(m.milestone_date) >= today && new Date(m.milestone_date) <= soon)
    .sort((a, b) => new Date(a.milestone_date) - new Date(b.milestone_date))
    .map(m => {
      const days = Math.ceil((new Date(m.milestone_date) - today) / 86400000)
      return { rag: days <= 2 ? 'a' : 'g', name: m.name, meta: projName(m.project_id), due: days <= 0 ? 'today' : `in ${days}d` }
    })
  return {
    type: 'list', title: 'Milestones due in the next 7 days', empty: 'No milestones due this week.',
    rows, commentary: rows.length ? `${rows.length} milestone${rows.length > 1 ? 's' : ''} within 7 days. Amber ones fall due in ≤2 days.` : null,
  }
}

async function runClients() {
  const { clients, projRollup } = await loadData()
  const rows = clients.map(c => {
    const cp = projRollup.filter(p => p.client_id === c.id)
    const people = new Set(cp.flatMap(p => p.memberIds)).size
    const done = cp.reduce((s, p) => s + p.done, 0)
    const total = cp.reduce((s, p) => s + p.total, 0)
    const pct = total > 0 ? Math.round((done / total) * 100) : 0
    return { label: c.name, sub: `${cp.length} project${cp.length === 1 ? '' : 's'} · ${people} ${people === 1 ? 'person' : 'people'}`, value: pct, drill: `Show me the details on ${c.name}` }
  }).sort((a, b) => a.value - b.value)
  return {
    type: 'progress', title: `Clients (${rows.length})`, rows,
    empty: 'No clients yet.',
    commentary: rows.length ? `${rows.length} client${rows.length === 1 ? '' : 's'} on the platform, sorted by completion. Tap "Open admin" on the dashboard to manage any of them.` : null,
  }
}

async function runUpcoming() {
  const { projRollup, milestones, today } = await loadData()
  const projName = id => projRollup.find(p => p.id === id)?.name ?? 'Project'
  const items = [
    ...(milestones ?? []).filter(m => m.milestone_date && new Date(m.milestone_date) >= today)
      .map(m => ({ date: m.milestone_date, label: m.name, project: projName(m.project_id) })),
    ...projRollup.flatMap(p => p.phases.filter(ph => ph.planned_start && new Date(ph.planned_start) > today)
      .map(ph => ({ date: ph.planned_start, label: `${ph.name} starts`, project: p.name }))),
  ].sort((a, b) => new Date(a.date) - new Date(b.date)).slice(0, 8)
  const rows = items.map(it => ({ rag: 'g', name: it.label, meta: it.project, due: fmtDate(it.date) }))
  return { type: 'list', title: 'Upcoming milestones', empty: 'Nothing scheduled ahead.', rows }
}

async function runProgress() {
  const { projRollup } = await loadData()
  const rows = projRollup.map(p => ({ label: p.name, value: p.pct, sub: p.clientName, drill: `Show me the ${p.name} timeline` }))
    .sort((a, b) => a.value - b.value)
  const avg = rows.length ? Math.round(rows.reduce((s, r) => s + r.value, 0) / rows.length) : 0
  const drag = rows[0], lead = rows[rows.length - 1]
  return {
    type: 'progress', title: 'Progress by project', rows,
    empty: 'No projects yet.',
    commentary: rows.length
      ? `${avg}% average completion across ${rows.length} project${rows.length > 1 ? 's' : ''}.${drag ? ` ${drag.label} (${drag.value}%) is the drag; ${lead.label} (${lead.value}%) leads.` : ''}`
      : null,
  }
}

async function runReadiness() {
  const { projRollup, surveys, today } = await loadData()
  const totalDone = projRollup.reduce((s, p) => s + p.done, 0)
  const totalAll = projRollup.reduce((s, p) => s + p.total, 0)
  const pct = totalAll > 0 ? Math.round((totalDone / totalAll) * 100) : 0
  const scores = surveys.filter(s => s.score != null)
  const avgScore = scores.length ? scores.reduce((s, r) => s + r.score, 0) / scores.length : null
  const ragLabel = avgScore == null ? 'Not yet measured' : avgScore >= 3.5 ? 'Green — on track' : avgScore >= 2.5 ? 'Amber — at risk' : 'Red — critical'
  const overdue = []
  projRollup.forEach(p => p.phases.forEach(ph => {
    if (ph.planned_end && new Date(ph.planned_end) < today && ph.pct < 100 && ph.steps > 0) overdue.push(ph)
  }))
  return {
    type: 'narrative', title: 'Readiness summary',
    body: `Overall readiness is **${ragLabel}**. Average pathway completion is **${pct}%** across ${projRollup.length} project${projRollup.length === 1 ? '' : 's'}` +
      `${scores.length ? `, from ${scores.length} survey response${scores.length === 1 ? '' : 's'}` : ' (no survey responses yet)'}. ` +
      `${overdue.length ? `**${overdue.length}** phase${overdue.length === 1 ? ' is' : 's are'} overdue and under 100% — the biggest lever on the RAG right now.` : 'No phases are currently overdue.'}`,
  }
}

async function runMembersBehind({ phase } = {}) {
  const { projRollup, profiles } = await loadData()
  const n = phase ?? 2
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
    type: 'list', title: `Members behind on ${PHASE_NAMES[n]} (Phase ${n})`,
    empty: `Everyone is up to date on ${PHASE_NAMES[n]}.`,
    rows: rows.slice(0, 15),
    commentary: rows.length ? `${rows.length} member${rows.length > 1 ? 's have' : ' has'} outstanding ${PHASE_NAMES[n]} steps. Red = not started.` : null,
  }
}

// Detail for a single named client — projects (with current phase), people, completion,
// overdue phases and next milestone. Grounded; mirrors the dashboard's expanded client view.
async function runClientDetail(client, data) {
  const { projRollup, today } = data
  const cp = projRollup.filter(p => p.client_id === client.id)
  const people = new Set(cp.flatMap(p => p.memberIds)).size
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
  const commentary = `**${client.name}** — ${cp.length} project${cp.length === 1 ? '' : 's'} · ${people} ${people === 1 ? 'person' : 'people'} · **${pct}%** average completion.` +
    (overdue ? ` ${overdue} phase${overdue === 1 ? ' is' : 's are'} overdue.` : '') +
    (nextMs ? ` Next milestone: ${nextMs.name} on ${new Date(nextMs.milestone_date).toLocaleDateString('en', { day: 'numeric', month: 'short' })}.` : '')
  return { type: 'progress', title: client.name, rows, empty: `${client.name} has no projects yet.`, commentary }
}

const fmtDate = d => new Date(d).toLocaleDateString('en', { day: 'numeric', month: 'short' })

// Detail for a single project — phase-by-phase completion, current phase, overdue, next milestone.
function runProjectDetail(p, data) {
  const { today } = data
  const rows = p.phases.map(ph => ({ label: ph.name, sub: ph.steps ? `${ph.done}/${ph.total} steps` : 'no steps yet', value: ph.pct }))
  const current = p.phases.find(ph => ph.planned_start && ph.planned_end && new Date(ph.planned_start) <= today && today <= new Date(ph.planned_end))
  const overdue = p.phases.filter(ph => ph.planned_end && new Date(ph.planned_end) < today && ph.pct < 100 && ph.steps > 0).length
  const nextMs = (p.milestones ?? []).filter(m => m.milestone_date && new Date(m.milestone_date) >= today).sort((a, b) => new Date(a.milestone_date) - new Date(b.milestone_date))[0]
  const commentary = `**${p.name}**${p.clientName ? ` · ${p.clientName}` : ''} — ${p.members} ${p.members === 1 ? 'person' : 'people'} · **${p.pct}%** complete.` +
    (current ? ` Currently in **${current.name}**.` : '') +
    (overdue ? ` ${overdue} phase${overdue === 1 ? ' is' : 's are'} overdue.` : '') +
    (nextMs ? ` Next milestone: ${nextMs.name} on ${fmtDate(nextMs.milestone_date)}.` : '')
  return { type: 'progress', title: p.name, rows, empty: 'No phases set up yet.', commentary }
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
  return { type: 'progress', title: prof?.full_name ?? 'Member', rows, empty: 'Not assigned to any projects.', commentary }
}

function runStakeholderDetail(s) {
  return { type: 'narrative', title: s.name, body: `**${s.name}**${s.detail ? ` — ${s.detail}` : ''}. In your stakeholder register.` }
}

// Generic grounded resolver: scan everything captured (clients, projects, people, stakeholders)
// for a name mentioned in the question, and return that record's detail. Prefers the longest
// (most specific) name match. This is what lets "any detail we have" be answered by the rules.
async function resolveEntity(text) {
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
  if (!matches.length) return null
  matches.sort((a, b) => b.name.length - a.name.length)   // most specific wins
  const m = matches[0]

  // "timeline / schedule / roadmap / gantt" → render the actual timeline (delivery + change
  // lanes + phases) rather than a progress list. Client → all its projects' timelines.
  const wantsTimeline = /(timeline|schedule|roadmap|gantt)/i.test(text)
  if (wantsTimeline && (m.type === 'client' || m.type === 'project')) {
    const projects = m.type === 'project'
      ? [{ id: m.id, name: m.name }]
      : data.projRollup.filter(p => p.client_id === m.id).map(p => ({ id: p.id, name: p.name }))
    return { type: 'timeline', descriptor: { type: 'projectTimeline', title: `${m.name} — timeline${projects.length === 1 ? '' : 's'}`, projects } }
  }

  let descriptor
  if (m.type === 'client')      descriptor = await runClientDetail(data.clients.find(c => c.id === m.id), data)
  else if (m.type === 'project')     descriptor = runProjectDetail(data.projRollup.find(p => p.id === m.id), data)
  else if (m.type === 'person')      descriptor = runPersonDetail(m.id, data)
  else                               descriptor = runStakeholderDetail(m)
  return { type: m.type, descriptor }
}

const RUNNERS = {
  clients: runClients,
  members_behind: runMembersBehind,
  at_risk: runAtRisk,
  milestones: runMilestones,
  upcoming: runUpcoming,
  progress: runProgress,
  readiness: runReadiness,
}

// Public: try to answer with rules. Returns { matched, intent, descriptor } — descriptor is
// null when no rule matched (router then escalates to the SLM).
export async function runRules(text) {
  const hit = matchIntent(text)
  if (hit) {
    const descriptor = await RUNNERS[hit.intent](hit.params)
    return { matched: true, intent: hit.intent, descriptor }
  }
  // Generic grounded fallback: does the question name anything we've captured — a client,
  // project, person or stakeholder? If so, answer from that record. Everything stays in rules.
  const resolved = await resolveEntity(text)
  if (resolved) return { matched: true, intent: `detail_${resolved.type}`, descriptor: resolved.descriptor }
  return { matched: false, intent: null, descriptor: null }
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
