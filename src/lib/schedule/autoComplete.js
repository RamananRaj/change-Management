// ChangeFlow · phase auto-complete rule (JS mirror of the SQL function
// auto_complete_phases()). The authoritative run happens nightly in Postgres; this pure
// mirror documents and tests the rule.
//
// A phase closes when the work under it is finished — every exercise completed by every
// assigned member. Completion is earned, never declared: there is deliberately no way to
// mark a phase done while its exercises are outstanding.

// phase: { status, lane_id, exercises: [{ completedBy }] }
// members: how many people are assigned to the project.
export function shouldComplete(phase, members = 1) {
  if (!phase || phase.status !== 'active') return false
  // Out of scope: not work this programme is running, so not work it can finish.
  if (phase.lane_id == null) return false
  const ex = phase.exercises ?? []
  // No exercises is not the same as all exercises done. Nothing has been asked of
  // anyone, so there is nothing to have completed.
  if (ex.length === 0) return false
  const seats = Math.max(members, 1)
  // The least-completed exercise decides it. "All of the work, by all of them" is a
  // statement about the weakest link, not an average — an average would let one finished
  // exercise cover for one nobody has touched.
  return ex.every(e => (e.completedBy ?? 0) >= seats)
}

export function phasesToComplete(phases, members = 1) {
  return (phases || []).filter(p => shouldComplete(p, members)).map(p => p.id)
}
