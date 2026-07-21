// ChangeFlow · phase auto-unlock rule (JS mirror of the SQL function auto_unlock_phases()).
// The authoritative unlock runs daily in Postgres via pg_cron; this pure mirror documents and
// tests the rule: a LOCKED phase whose planned_start has arrived becomes ACTIVE. Completion is
// progress-driven and is NOT changed here.

// today defaults to now; pass a Date for deterministic tests.
export function shouldUnlock(phase, today = new Date()) {
  if (!phase || phase.status !== 'locked') return false
  // Release mode is the admin's decision about WHEN this phase opens, and it outranks
  // the schedule in both directions. Held phases stay shut however old their dates;
  // phases opened early skip the date test entirely.
  const mode = phase.release_mode ?? 'plan'
  if (mode === 'hold') return false
  if (mode === 'open') return phase.lane_id != null
  if (!phase.planned_start) return false
  // Scope gates the schedule. A deferred phase can carry dates — they describe when that
  // work is expected in a later programme, not permission to open it now. Without this,
  // deferring a phase that already has dates gets silently undone by the nightly job.
  if (phase.lane_id === null || phase.lane_id === undefined) return false
  return new Date(phase.planned_start + 'T00:00:00') <= today
}

// Apply the rule to a list, returning the ids that would flip to 'active'.
export function phasesToUnlock(phases, today = new Date()) {
  return (phases || []).filter(p => shouldUnlock(p, today)).map(p => p.id)
}
