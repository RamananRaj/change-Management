import { describe, it, expect } from 'vitest'
import { buildReportGantt, buildIntegratedInsight, normPhrase, distinctiveTokens } from './analysis'

const heat = {
  version: 1,
  cols: ['People', 'Process', 'Information', 'Technology'],
  rows: [
    { label: 'Asset Planning & Delivery', cells: ['h', 'm', 'h', 'm'] },
    { label: 'Customer & Community', cells: ['m', 'm', 'l', 'l'] },
    { label: 'Finance', cells: ['m', 'm', 'm', 'm'] },
    { label: 'Operations', cells: ['h', 'h', 'm', 'h'] },
    { label: 'People & Safety', cells: ['m', 'l', 'l', 'm'] },
    { label: 'Information & Technology', cells: ['h', 'm', 'h', 'vh'] },
  ],
}

describe('buildIntegratedInsight', () => {
  it('ranks groups by severity, I&T first', () => {
    const r = buildIntegratedInsight(heat, { pct: 0, atRisk: [], avg: null, ragWord: 'not measured', upcoming: [] })
    expect(r.type).toBe('insight')
    expect(r.areas.map(a => a.name)).toEqual(['Information & Technology', 'Operations', 'Asset Planning & Delivery'])
    expect(r.areas[0].chips[0]).toBe('Impact Very High')
    expect(r.areas[0].evidence).toContain('heat map v1')
  })
  it('mentions overdue phases when present', () => {
    const r = buildIntegratedInsight(heat, { pct: 40, atRisk: [{}, {}], avg: 3.0, ragWord: 'Amber', upcoming: [] })
    expect(r.lead).toContain('2 phases overdue')
    expect(r.move).toContain('overdue')
  })
  it('returns null with no heat rows', () => {
    expect(buildIntegratedInsight({ rows: [] }, { pct: 0, atRisk: [], avg: null, upcoming: [] })).toBeNull()
  })
})

describe('buildReportGantt', () => {
  const cp = [{
    name: 'RSR Program',
    phases: [
      { phase_number: 1, name: 'Diagnose', planned_start: '2026-07-01', planned_end: '2026-07-31', pct: 0 },
      { phase_number: 2, name: 'Design', planned_start: '2026-08-01', planned_end: '2026-08-31', pct: 100 },
      { phase_number: 3, name: 'Engage', planned_start: null, planned_end: null, pct: 0 },
    ],
    milestones: [{ name: 'Go-Live', milestone_date: '2026-09-15', color: '#1F4E79' }],
  }]
  it('buckets months across the date range and indexes bars', () => {
    const g = buildReportGantt(cp)
    expect(g.months.length).toBe(3)              // Jul, Aug, Sep
    const bars = g.projects[0].rows.filter(r => r.kind === 'bar')
    expect(bars).toHaveLength(2)                 // Engage has no dates → skipped
    expect(bars[0]).toMatchObject({ startIdx: 0, endIdx: 0, label: '01 Diagnose' })
    expect(bars[1]).toMatchObject({ startIdx: 1, endIdx: 1, status: 'completed' })
    const point = g.projects[0].rows.find(r => r.kind === 'point')
    expect(point).toMatchObject({ pointIdx: 2, label: 'Go-Live' })
  })
  it('returns null when there are no dates', () => {
    expect(buildReportGantt([{ name: 'X', phases: [{ phase_number: 1, name: 'Diagnose' }], milestones: [] }])).toBeNull()
  })
})

describe('phrase tokeniser', () => {
  it('normalises text', () => {
    expect(normPhrase('  Exec-Pack, for Horizon!! ')).toBe('exec pack for horizon')
  })
  it('strips entity names and stopwords, keeps distinctive tokens', () => {
    const t = distinctiveTokens('give me the exec pack for Horizon Power', ['Horizon Power'])
    expect(t).toEqual(['exec', 'pack'])
  })
  it('a learned pattern generalises across entities (subset match)', () => {
    const learned = distinctiveTokens('exec pack for Horizon Power', ['Horizon Power'])   // ['exec','pack']
    const query = new Set(distinctiveTokens('give me the exec pack for Western Power'))
    expect(learned.every(tok => query.has(tok))).toBe(true)
  })
})
