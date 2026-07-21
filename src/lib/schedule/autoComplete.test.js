import { describe, it, expect } from 'vitest'
import { shouldComplete, phasesToComplete } from './autoComplete'

const IN_SCOPE = 'lane-1'
const ex = (...counts) => counts.map(c => ({ completedBy: c }))

describe('shouldComplete', () => {
  it('completes when every exercise is done by every member', () => {
    expect(shouldComplete(
      { status: 'active', lane_id: IN_SCOPE, exercises: ex(2, 2, 2) }, 2,
    )).toBe(true)
  })

  it('does NOT complete when one exercise is short', () => {
    // The case the old manual cycler allowed: a phase marked done with work outstanding.
    expect(shouldComplete(
      { status: 'active', lane_id: IN_SCOPE, exercises: ex(2, 2, 1) }, 2,
    )).toBe(false)
  })

  it('does NOT complete a phase with no exercises', () => {
    // Empty is not finished. Nothing was asked, so nothing was completed.
    expect(shouldComplete(
      { status: 'active', lane_id: IN_SCOPE, exercises: [] }, 1,
    )).toBe(false)
  })

  it('does NOT complete an out-of-scope phase', () => {
    expect(shouldComplete(
      { status: 'active', lane_id: null, exercises: ex(1) }, 1,
    )).toBe(false)
  })

  it('leaves a locked phase alone', () => {
    // Completion follows opening; it never skips it.
    expect(shouldComplete(
      { status: 'locked', lane_id: IN_SCOPE, exercises: ex(1) }, 1,
    )).toBe(false)
  })

  it('never re-opens or re-completes an already completed phase', () => {
    expect(shouldComplete(
      { status: 'completed', lane_id: IN_SCOPE, exercises: ex(1) }, 1,
    )).toBe(false)
  })

  it('an average would pass, but the weakest link decides', () => {
    // 3 done twice over and 1 untouched averages above the bar; it is still not finished.
    expect(shouldComplete(
      { status: 'active', lane_id: IN_SCOPE, exercises: ex(2, 2, 2, 0) }, 2,
    )).toBe(false)
  })
})

describe('phasesToComplete', () => {
  it('returns only the finished, in-scope, active phases', () => {
    expect(phasesToComplete([
      { id: 'a', status: 'active',    lane_id: IN_SCOPE, exercises: ex(1, 1) },
      { id: 'b', status: 'active',    lane_id: IN_SCOPE, exercises: ex(1, 0) },
      { id: 'c', status: 'active',    lane_id: null,     exercises: ex(1) },
      { id: 'd', status: 'completed', lane_id: IN_SCOPE, exercises: ex(1) },
    ], 1)).toEqual(['a'])
  })
})
