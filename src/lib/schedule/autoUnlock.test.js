import { describe, it, expect } from 'vitest'
import { shouldUnlock, phasesToUnlock } from './autoUnlock'

const today = new Date('2026-07-19T00:00:00Z')

describe('shouldUnlock', () => {
  it('unlocks a locked phase whose start has passed', () => {
    expect(shouldUnlock({ status: 'locked', planned_start: '2026-07-01' }, today)).toBe(true)
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
      { id: 'a', status: 'locked', planned_start: '2026-07-01' },   // due
      { id: 'b', status: 'locked', planned_start: '2026-09-01' },   // future
      { id: 'c', status: 'active', planned_start: '2026-07-01' },   // already active
      { id: 'd', status: 'locked', planned_start: null },           // no date
    ]
    expect(phasesToUnlock(phases, today)).toEqual(['a'])
  })
})
