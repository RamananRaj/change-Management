import { describe, it, expect } from 'vitest'
import {
  accessLevel, canAdminAct, rag, pct, splitPathway, phaseStatus, atRiskPhases, upcoming,
} from './logic'

// Fixtures
const master  = { id: 'm', is_admin: true,  is_client_admin: false, client_id: null }
const cAdminA = { id: 'ca', is_admin: false, is_client_admin: true,  client_id: 'A' }
const memberA = { id: 'u1', is_admin: false, is_client_admin: false, client_id: 'A' }
const memberB = { id: 'u2', is_admin: false, is_client_admin: false, client_id: 'B' }
const cAdminB = { id: 'cb', is_admin: false, is_client_admin: true,  client_id: 'B' }

describe('accessLevel', () => {
  it('maps flags to tiers', () => {
    expect(accessLevel(master)).toBe('Master Admin')
    expect(accessLevel(cAdminA)).toBe('Client Admin')
    expect(accessLevel(memberA)).toBe('Member')
    expect(accessLevel(null)).toBe('Member')
  })
})

describe('canAdminAct — Master Admin', () => {
  it('may act on any user', () => {
    for (const t of [memberA, memberB, cAdminA]) {
      expect(canAdminAct(master, t, 'edit')).toBe(true)
      expect(canAdminAct(master, t, 'delete')).toBe(true)
    }
  })
  it('cannot delete or lock itself', () => {
    expect(canAdminAct(master, master, 'delete')).toBe(false)
    expect(canAdminAct(master, master, 'lock')).toBe(false)
    expect(canAdminAct(master, master, 'edit')).toBe(true)   // editing self is fine
  })
})

describe('canAdminAct — Client Admin', () => {
  it('may act on its own client’s members', () => {
    expect(canAdminAct(cAdminA, memberA, 'edit')).toBe(true)
    expect(canAdminAct(cAdminA, memberA, 'reset')).toBe(true)
    expect(canAdminAct(cAdminA, memberA, 'delete')).toBe(true)
  })
  it('may NOT act on another client’s users', () => {
    expect(canAdminAct(cAdminA, memberB, 'edit')).toBe(false)
    expect(canAdminAct(cAdminA, cAdminB, 'edit')).toBe(false)
  })
  it('may NOT act on a Master Admin', () => {
    expect(canAdminAct(cAdminA, master, 'edit')).toBe(false)
  })
  it('may NOT act on a user with no client', () => {
    expect(canAdminAct(cAdminA, { id: 'x', is_admin: false, client_id: null }, 'edit')).toBe(false)
  })
})

describe('canAdminAct — Members', () => {
  it('a plain member can act on no one', () => {
    expect(canAdminAct(memberA, memberA, 'edit')).toBe(false)
    expect(canAdminAct(memberA, memberB, 'edit')).toBe(false)
  })
})

describe('rag', () => {
  it('thresholds', () => {
    expect(rag(4.0)).toBe('green')
    expect(rag(3.5)).toBe('green')
    expect(rag(3.0)).toBe('amber')
    expect(rag(2.5)).toBe('amber')
    expect(rag(1.0)).toBe('red')
    expect(rag(null)).toBe(null)
    expect(rag(undefined)).toBe(null)
  })
})

describe('pct', () => {
  it('rounds and guards zero', () => {
    expect(pct(1, 8)).toBe(13)
    expect(pct(0, 0)).toBe(0)
    expect(pct(3, 3)).toBe(100)
  })
})

describe('splitPathway', () => {
  const items = [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }]
  const steps = { a: 2, b: '', c: 1, d: null }
  const stepOf = id => steps[id]
  it('separates and sorts in-path by step', () => {
    const { inPath, notInPath } = splitPathway(items, stepOf)
    expect(inPath.map(i => i.id)).toEqual(['c', 'a'])       // step 1 then 2
    expect(notInPath.map(i => i.id)).toEqual(['b', 'd'])
  })
})

describe('phaseStatus', () => {
  const today = new Date('2026-07-15')
  it('completed when 100% or marked done', () => {
    expect(phaseStatus({ pct: 100 }, today)).toBe('completed')
    expect(phaseStatus({ status: 'completed' }, today)).toBe('completed')
  })
  it('active when today is within the window', () => {
    expect(phaseStatus({ planned_start: '2026-07-01', planned_end: '2026-07-31', pct: 10 }, today)).toBe('active')
  })
  it('active (overdue) when past end and unfinished', () => {
    expect(phaseStatus({ planned_start: '2026-06-01', planned_end: '2026-06-30', pct: 40 }, today)).toBe('active')
  })
  it('locked when still upcoming', () => {
    expect(phaseStatus({ planned_start: '2026-09-01', planned_end: '2026-09-30', pct: 0 }, today)).toBe('locked')
  })
})

describe('atRiskPhases', () => {
  const today = new Date('2026-07-15')
  it('flags overdue, unfinished phases with steps', () => {
    const phases = [
      { name: 'Diagnose', planned_end: '2026-06-30', pct: 60, steps: 3 },  // overdue → risk
      { name: 'Design',   planned_end: '2026-08-31', pct: 0,  steps: 3 },  // future → ok
      { name: 'Engage',   planned_end: '2026-06-30', pct: 100, steps: 3 }, // done → ok
      { name: 'Embed',    planned_end: '2026-06-30', pct: 0,  steps: 0 },  // no steps → ok
    ]
    expect(atRiskPhases(phases, today).map(p => p.name)).toEqual(['Diagnose'])
  })
})

describe('upcoming', () => {
  const today = new Date('2026-07-15')
  it('merges milestones + phase starts, soonest first, limited', () => {
    const milestones = [{ name: 'Go-live', milestone_date: '2026-11-30' }, { name: 'Past', milestone_date: '2026-01-01' }]
    const phases = [{ name: 'Design', planned_start: '2026-08-01' }, { name: 'Diagnose', planned_start: '2026-07-01' }]
    const out = upcoming(milestones, phases, today, 6)
    expect(out.map(u => u.label)).toEqual(['Design starts', 'Go-live'])   // past ones dropped, sorted
    expect(out[0].kind).toBe('phase')
  })
})
