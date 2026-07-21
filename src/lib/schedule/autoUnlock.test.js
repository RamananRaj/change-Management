import { describe, it, expect } from 'vitest'
import { shouldUnlock, phasesToUnlock } from './autoUnlock'

const today = new Date('2026-07-19T00:00:00Z')

// These fixtures predate scope and carried no lane_id. The rule now requires one, and
// the JS must mirror the SQL that actually runs — which tests `lane_id IS NOT NULL`.
// So the fixtures were incomplete, not the new behaviour: adding lane_id describes the
// phase these tests always meant (one being run), rather than relaxing the rule to keep
// them green.
const IN_SCOPE = 'lane-1'

describe('shouldUnlock', () => {
  it('unlocks a locked phase whose start has passed', () => {
    expect(shouldUnlock({ status: 'locked', planned_start: '2026-07-01', lane_id: IN_SCOPE }, today)).toBe(true)
  })
  it('does not unlock a future phase', () => {
    expect(shouldUnlock({ status: 'locked', planned_start: '2026-08-01' }, today)).toBe(false)
  })
  it('ignores phases that are not locked', () => {
    expect(shouldUnlock({ status: 'active', planned_start: '2026-07-01' }, today)).toBe(false)
    expect(shouldUnlock({ status: 'completed', planned_start: '2026-07-01' }, today)).toBe(false)
  })
  it('does nothing without a start date', () => {
    expect(shouldUnlock({ status: 'locked', planned_start: null }, today)).toBe(false)
  })
})

describe('phasesToUnlock', () => {
  it('returns only the due, locked phase ids', () => {
    const phases = [
      { id: 'a', status: 'locked', planned_start: '2026-07-01', lane_id: IN_SCOPE }, // due
      { id: 'b', status: 'locked', planned_start: '2026-09-01', lane_id: IN_SCOPE }, // future
      { id: 'c', status: 'active', planned_start: '2026-07-01', lane_id: IN_SCOPE }, // already active
      { id: 'd', status: 'locked', planned_start: null,         lane_id: IN_SCOPE }, // no date
      { id: 'e', status: 'locked', planned_start: '2026-07-01', lane_id: null },     // deferred
    ]
    expect(phasesToUnlock(phases, today)).toEqual(['a'])
  })
})

describe('auto-unlock respects programme scope', () => {
  const today = new Date('2026-07-21T00:00:00')

  it('does not unlock a deferred phase whose start date has passed', () => {
    // The case that motivated the fix: a phase deferred AFTER its dates were set.
    // The date test passes, so only scope stops the nightly job reopening it.
    expect(shouldUnlock(
      { status: 'locked', planned_start: '2026-01-01', lane_id: null }, today,
    )).toBe(false)
  })

  it('still unlocks an in-scope phase whose start date has passed', () => {
    expect(shouldUnlock(
      { status: 'locked', planned_start: '2026-01-01', lane_id: 'lane-1' }, today,
    )).toBe(true)
  })

  it('treats a missing lane_id as out of scope rather than assuming in', () => {
    // Guessing "in scope" on absent data would reopen phases nobody is running, which
    // is the louder failure of the two.
    expect(shouldUnlock({ status: 'locked', planned_start: '2026-01-01' }, today)).toBe(false)
  })

  it('filters deferred phases out of the batch', () => {
    const ids = phasesToUnlock([
      { id: 'a', status: 'locked', planned_start: '2026-01-01', lane_id: 'L' },
      { id: 'b', status: 'locked', planned_start: '2026-01-01', lane_id: null },
    ], today)
    expect(ids).toEqual(['a'])
  })
})

describe('release mode outranks the schedule', () => {
  const today = new Date('2026-07-21T00:00:00')

  it("'open' releases a phase whose date has not arrived", () => {
    expect(shouldUnlock(
      { status: 'locked', planned_start: '2026-12-01', lane_id: 'L', release_mode: 'open' }, today,
    )).toBe(true)
  })

  it("'open' still respects scope", () => {
    expect(shouldUnlock(
      { status: 'locked', planned_start: '2026-12-01', lane_id: null, release_mode: 'open' }, today,
    )).toBe(false)
  })

  it("'hold' keeps a phase shut although its date has passed", () => {
    // Previously the only way to achieve this was deleting the phase's start date,
    // which destroyed plan data to express an intent.
    expect(shouldUnlock(
      { status: 'locked', planned_start: '2026-01-01', lane_id: 'L', release_mode: 'hold' }, today,
    )).toBe(false)
  })

  it("defaults to 'plan' when the column is absent", () => {
    expect(shouldUnlock(
      { status: 'locked', planned_start: '2026-01-01', lane_id: 'L' }, today,
    )).toBe(true)
  })
})
