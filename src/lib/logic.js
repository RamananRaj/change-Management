// Canonical, side-effect-free logic for ChangeFlow. Extracted here so it can be unit
// tested (see logic.test.js) and shared across components. No React, no Supabase.

// ── Access ───────────────────────────────────────────────────────────────────
// Human-readable access tier from profile flags.
export function accessLevel(p) {
  if (p?.is_admin)        return 'Master Admin'
  if (p?.is_client_admin) return 'Client Admin'
  return 'Member'
}

// Authorization mirror of the admin-user-actions Edge Function. Kept in sync so the
// rules can be unit-tested without deploying. caller/target: { id, is_admin,
// is_client_admin, client_id }. Returns true if `caller` may run `action` on `target`.
export function canAdminAct(caller, target, action) {
  if (!caller || (!caller.is_admin && !caller.is_client_admin)) return false
  if (!target) return false
  const isMaster = !!caller.is_admin
  const clientOk = !!caller.is_client_admin && !target.is_admin && !!target.client_id && target.client_id === caller.client_id
  if (!isMaster && !clientOk) return false
  if (!isMaster && target.is_admin) return false                       // client admin can't touch admins
  if (caller.id === target.id && (action === 'delete' || action === 'lock')) return false  // no self lock/delete
  return true
}

// ── Readiness (survey RAG) ───────────────────────────────────────────────────
export function rag(score, green = 3.5, amber = 2.5) {
  if (score === null || score === undefined) return null
  if (score >= green) return 'green'
  if (score >= amber) return 'amber'
  return 'red'
}

// ── Progress ─────────────────────────────────────────────────────────────────
export function pct(done, total) {
  return total > 0 ? Math.round((done / total) * 100) : 0
}

// ── Pathway editor split (in-path vs not) ────────────────────────────────────
// stepOf(id) → '' | null | number. Returns items grouped and in-path sorted by step.
export function splitPathway(items, stepOf) {
  const has = i => { const s = stepOf(i.id); return s !== '' && s !== null && s !== undefined }
  const inPath = items.filter(has).sort((a, b) => Number(stepOf(a.id)) - Number(stepOf(b.id)))
  const notInPath = items.filter(i => !has(i))
  return { inPath, notInPath }
}

// ── Timeline / schedule ──────────────────────────────────────────────────────
// Effective phase status driven by the schedule (today vs planned dates), not just the
// stored status. 'completed' | 'active' | 'locked'.
export function phaseStatus(phase, today = new Date()) {
  const { planned_start, planned_end, status, pct: p = 0 } = phase ?? {}
  if (p >= 100 || status === 'completed' || status === 'done') return 'completed'
  if (planned_start && planned_end) {
    const s = new Date(planned_start), e = new Date(planned_end)
    if (today >= s && today <= e) return 'active'
    if (today > e)                return 'active'   // overdue but underway
    return 'locked'                                 // upcoming
  }
  return status ?? 'locked'
}

// Phases past their end date but not finished (and actually have steps).
export function atRiskPhases(phases, today = new Date()) {
  return (phases ?? []).filter(p =>
    p.planned_end && new Date(p.planned_end) < today && (p.pct ?? 0) < 100 && (p.steps ?? p.available ?? 0) > 0)
}

// Next milestones + phase starts, soonest first.
export function upcoming(milestones, phases, today = new Date(), limit = 6) {
  const items = [
    ...(milestones ?? []).filter(m => m.milestone_date && new Date(m.milestone_date) >= today)
      .map(m => ({ date: m.milestone_date, label: m.name, kind: 'milestone' })),
    ...(phases ?? []).filter(p => p.planned_start && new Date(p.planned_start) > today)
      .map(p => ({ date: p.planned_start, label: `${p.name} starts`, kind: 'phase' })),
  ].sort((a, b) => new Date(a.date) - new Date(b.date))
  return items.slice(0, limit)
}
