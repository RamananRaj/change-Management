import { describe, it, expect } from 'vitest'
import { buildReportGantt, buildIntegratedInsight, normPhrase, distinctiveTokens, resolveScope, scopedProjects, buildPhaseDrill, groundedFallback, resolveUsageScope, renderTemplate, templateTokens, matchKnowledgeRule, computeTrend, trendSentence, buildTrendChart, buildLaneTree, laneStyle, rowsForLane, groupLaneRows, clampPct, fuzzyEntityMatch, matchByPartialName, distinctiveNameTokens, buildProgrammeStory, renderStory } from './analysis'

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

describe('resolveScope + scopedProjects', () => {
  const data = {
    clients: [{ id: 'c1', name: 'Horizon Power' }, { id: 'c2', name: 'Western Power' }],
    projRollup: [
      { id: 'p1', name: 'RSR Program', client_id: 'c1' },
      { id: 'p2', name: 'Billing Uplift', client_id: 'c1' },
      { id: 'p3', name: 'Grid Modernisation', client_id: 'c2' },
    ],
  }

  it('scopes to a project named in the text', () => {
    const s = resolveScope('how is the RSR Program going', {}, data)
    expect(s.proj?.id).toBe('p1')
    expect(s.suffix).toBe(' · RSR Program')
    expect(scopedProjects(data, s).map(p => p.id)).toEqual(['p1'])
  })

  it('scopes to a client named in the text (all their projects)', () => {
    const s = resolveScope('show progress for Horizon Power', {}, data)
    expect(s.client?.id).toBe('c1')
    expect(scopedProjects(data, s).map(p => p.id)).toEqual(['p1', 'p2'])
  })

  it('falls back to the remembered entity when the text names nothing', () => {
    const s = resolveScope('what is at risk', { entity: 'RSR Program' }, data)
    expect(s.proj?.id).toBe('p1')
  })

  it('an explicitly named entity overrides the remembered one', () => {
    const s = resolveScope('progress for Western Power', { entity: 'RSR Program' }, data)
    expect(s.client?.id).toBe('c2')
    expect(s.proj).toBeNull()
  })

  it('returns all projects and no suffix when nothing is in scope', () => {
    const s = resolveScope('overall progress', {}, data)
    expect(s.label).toBeNull()
    expect(s.suffix).toBe('')
    expect(scopedProjects(data, s)).toHaveLength(3)
  })
})

describe('buildPhaseDrill', () => {
  const profiles = [{ id: 'u1', full_name: 'Jane Smith' }, { id: 'u2', full_name: 'Ravi Patel' }]
  const args = {
    projectName: 'RSR Program', phaseName: 'Diagnose',
    orderedContentIds: ['a1', 'a2'],
    content: [{ id: 'a1', title: 'Stakeholder Map', content_type: 'exercise' }, { id: 'a2', title: 'Impact Assessment', content_type: 'template' }],
    completions: [{ user_id: 'u1', content_id: 'a1' }, { user_id: 'u2', content_id: 'a1' }],
    memberIds: ['u1', 'u2'], profiles,
  }

  it('builds a row per activity with type, done count and completer names', () => {
    const d = buildPhaseDrill(args)
    expect(d.type).toBe('progress')
    expect(d.title).toBe('RSR Program · Diagnose')
    expect(d.rows).toHaveLength(2)
    expect(d.rows[0]).toMatchObject({ label: 'Stakeholder Map', value: 100 })
    expect(d.rows[0].sub).toBe('exercise · 2/2 done · Jane Smith, Ravi Patel')
    expect(d.rows[1]).toMatchObject({ label: 'Impact Assessment', value: 0 })
    expect(d.rows[1].sub).toContain('not started')
  })

  it('summarises owners and fully-complete count in the intro', () => {
    const d = buildPhaseDrill(args)
    expect(d.intro).toContain('**2** activities')
    expect(d.intro).toContain('Jane Smith')
    expect(d.intro).toContain('**1/2** is fully complete')
  })

  it('handles no members assigned', () => {
    const d = buildPhaseDrill({ ...args, memberIds: [], completions: [] })
    expect(d.rows[0].value).toBe(0)
    expect(d.intro).toContain('no members assigned yet')
  })
})

describe('groundedFallback', () => {
  const grounding = [
    'Client: Horizon Power (as of 19 Jul 2026)',
    'Project "RSR Program": 6 people, 42% complete.',
    '  • Phase 1 Diagnose: 80% (in progress) [01 Jul 2026→31 Jul 2026]',
    '  • Phase 2 Design: 10% (upcoming)',
    'Readiness: 3.1/5 — Amber/at risk from 4 responses.',
    'Overdue/at-risk phases: Design · RSR Program (10%).',
  ].join('\n')

  it('returns null without grounding', () => {
    expect(groundedFallback('anything', '')).toBeNull()
    expect(groundedFallback('anything', null)).toBeNull()
  })

  it('surfaces the lines most relevant to the question', () => {
    const out = groundedFallback('how is readiness looking?', grounding)
    expect(out).toContain('Readiness: 3.1/5')
    expect(out).toContain('_Client: Horizon Power (as of 19 Jul 2026)_')   // header echoed
    expect(out).not.toContain('model tier configured for open-ended reasoning\n\n_Client')   // has a lead
  })

  it('falls back to the snapshot when nothing matches', () => {
    const out = groundedFallback('zzzzz', grounding)
    expect(out).toContain('grounded snapshot')
    expect(out).toContain('RSR Program')
  })
})

describe('renderTemplate / templateTokens', () => {
  const body = 'Audiences: {{audiences}}. Owners: {{owners}}. Starts {{ phase2 }}.'

  it('fills tokens from live data', () => {
    expect(renderTemplate(body, { audiences: 'Ops (High)', owners: 'Jane', phase2: '1 Aug 2026' }))
      .toBe('Audiences: Ops (High). Owners: Jane. Starts 1 Aug 2026.')
  })

  it('never leaks raw braces for missing or empty values', () => {
    const out = renderTemplate(body, { audiences: 'Ops' })
    expect(out).not.toContain('{{')
    expect(out).toContain('Owners: —')
  })

  it('lists a rule’s data dependencies', () => {
    expect(templateTokens(body).sort()).toEqual(['audiences', 'owners', 'phase2'])
  })

  it('handles empty input safely', () => {
    expect(renderTemplate('', {})).toBe('')
    expect(renderTemplate(null, {})).toBe('')
    expect(templateTokens(null)).toEqual([])
  })
})

describe('computeTrend', () => {
  const today = new Date('2026-07-19T00:00:00Z')
  const snap = (daysAgo, pct) => ({ captured_on: new Date(today.getTime() - daysAgo * 864e5).toISOString().slice(0, 10), pct })

  it('reports nothing when there is no history', () => {
    expect(computeTrend([], { today }).status).toBe('none')
  })

  it('says it is still building with under a day of history', () => {
    const t = computeTrend([snap(0, 20)], { today })
    expect(t.status).toBe('building')
    expect(t.current).toBe(20)
  })

  it('computes weekly velocity and a forecast', () => {
    // 28 days ago 20% → today 48% = 28 points over 28 days = 7%/week; 52 remaining ≈ 7.4 weeks
    const t = computeTrend([snap(28, 20), snap(14, 34), snap(7, 41), snap(0, 48)], { today })
    expect(t.status).toBe('ok')
    expect(t.current).toBe(48)
    expect(t.delta7).toBe(7)
    expect(t.delta28).toBe(28)
    expect(t.perWeek).toBe(7)
    expect(t.weeksLeft).toBeCloseTo(7.4, 0)
  })

  it('flags a stall rather than forecasting from noise', () => {
    const t = computeTrend([snap(28, 40), snap(14, 40), snap(0, 40)], { today })
    expect(t.verdict).toBe('stalled')
    expect(t.forecast).toBeNull()
    expect(trendSentence(t)).toContain('stalled')
  })

  it('judges against the planned end date', () => {
    const pts = [snap(28, 20), snap(0, 48)]                       // 7%/week → ~7.4 weeks left
    const behind = computeTrend(pts, { today, plannedEnd: '2026-08-01' })   // way before forecast
    expect(behind.verdict).toBe('behind')
    expect(behind.slipDays).toBeGreaterThan(7)
    const ahead = computeTrend(pts, { today, plannedEnd: '2027-01-01' })
    expect(ahead.verdict).toBe('ahead')
  })

  it('recognises completion', () => {
    const t = computeTrend([snap(14, 100), snap(0, 100)], { today })
    expect(t.verdict).toBe('complete')
    expect(trendSentence(t)).toContain('complete')
  })
})

describe('buildTrendChart', () => {
  const today = new Date('2026-07-19T00:00:00Z')
  const snap = (daysAgo, pct) => ({ captured_on: new Date(today.getTime() - daysAgo * 864e5).toISOString().slice(0, 10), pct })

  const rsr = { name: 'RSR Program', points: [snap(28, 20), snap(14, 34), snap(0, 48)] }
  const erp = { name: 'ERP Rollout', points: [snap(28, 0), snap(14, 0), snap(0, 0)] }

  it('plots a line through the history', () => {
    const c = buildTrendChart([rsr], { today })
    expect(c.sparse).toBe(false)
    expect(c.multi).toBe(false)
    expect(c.series[0].coords).toHaveLength(3)
    expect(c.series[0].line).toMatch(/^M[\d.]+,[\d.]+ L/)
    expect(c.series[0].current).toBe(48)
    // higher pct sits higher on the canvas (smaller y)
    expect(c.series[0].coords[2].y).toBeLessThan(c.series[0].coords[0].y)
  })

  it('keeps one line per programme rather than averaging them', () => {
    const c = buildTrendChart([rsr, erp], { today })
    expect(c.multi).toBe(true)
    expect(c.series.map(s => s.name)).toEqual(['RSR Program', 'ERP Rollout'])
    expect(c.series[0].current).toBe(48)   // the moving programme keeps its own value
    expect(c.series[1].current).toBe(0)    // the stalled one is visibly separate, not blended to 24%
    expect(c.series[0].color).not.toBe(c.series[1].color)
    expect(c.series[0].area).toBeNull()    // no shaded fill when lines overlap
  })

  it('flags sparse history but still returns a usable chart', () => {
    const c = buildTrendChart([{ name: 'RSR Program', points: [snap(0, 12)] }], { today, plannedEnd: '2026-09-30' })
    expect(c.sparse).toBe(true)
    expect(c.series[0].line).toBeNull()   // nothing to join yet
    expect(c.plannedX).not.toBeNull()     // but the plan marker still renders
    expect(c.series[0].current).toBe(12)
  })

  it('handles no data at all without throwing', () => {
    const c = buildTrendChart([], { today })
    expect(c.sparse).toBe(true)
    expect(c.series).toEqual([])
  })

  it('draws a dashed projection per programme', () => {
    const c = buildTrendChart([{ ...rsr, forecast: '2026-09-01' }], { today })
    expect(c.series[0].forecastLine).toMatch(/^M[\d.]+,[\d.]+ L/)
    expect(c.series[0].forecastPt.y).toBe(c.topY)   // forecast lands at 100%
  })
})

describe('resolveUsageScope', () => {
  const clients = [{ id: 'c1', name: 'Horizon Power' }, { id: 'c2', name: 'Western Power' }]
  const projects = [{ id: 'p1', name: 'RSR Program', client_id: 'c1' }, { id: 'p3', name: 'Grid Modernisation', client_id: 'c2' }]

  it('attributes to a project named in the text and infers its client', () => {
    expect(resolveUsageScope('how is the RSR Program tracking', null, clients, projects)).toEqual({ clientId: 'c1', projectId: 'p1' })
  })

  it('attributes to a client when only the client is named', () => {
    expect(resolveUsageScope('overall risks for Horizon Power', null, clients, projects)).toEqual({ clientId: 'c1', projectId: null })
  })

  it('uses the remembered entity when the text names nothing', () => {
    expect(resolveUsageScope('give me more detail', 'RSR Program', clients, projects)).toEqual({ clientId: 'c1', projectId: 'p1' })
  })

  it('returns nulls when nothing matches', () => {
    expect(resolveUsageScope('what is at risk everywhere', null, clients, projects)).toEqual({ clientId: null, projectId: null })
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

describe('matchKnowledgeRule', () => {
  const rules = [
    { topic: 'training', title: 'Training Approach', triggers: ['training', 'learning'] },
    { topic: 'ttt', title: 'Train-the-Trainer Approach', triggers: ['train the trainer', 'ttt', 'cascade'] },
    { topic: 'comms', title: 'Communications Approach', triggers: ['comms', 'communication'] },
  ]

  it('routes a question to the rule whose trigger it contains', () => {
    expect(matchKnowledgeRule('Define Training Approach', rules).topic).toBe('training')
    expect(matchKnowledgeRule('what is our comms plan', rules).topic).toBe('comms')
  })

  it('prefers the longest matching trigger, so specific beats general', () => {
    // "train the trainer" also contains "train"; the longer trigger must win over 'training'
    expect(matchKnowledgeRule('train the trainer approach', rules).topic).toBe('ttt')
  })

  it('returns null when nothing matches, so grounded tiers stay in control', () => {
    expect(matchKnowledgeRule('what is at risk this week', rules)).toBeNull()
    expect(matchKnowledgeRule('', rules)).toBeNull()
  })

  it('tolerates rules with no triggers', () => {
    expect(matchKnowledgeRule('training', [{ topic: 'x' }, ...rules]).topic).toBe('training')
  })
})

describe('timeline swimlanes', () => {
  const lanes = [
    { id: 'a', name: 'Delivery', tint: '#eff6ff', sort_order: 0, parent_id: null },
    { id: 'b', name: 'Change',   tint: '#f0fdfa', sort_order: 1, parent_id: null },
    { id: 'b1', name: 'Comms',   tint: '#f8fafc', sort_order: 0, parent_id: 'b' },
    { id: 'b2', name: 'Training',tint: '#f8fafc', sort_order: 1, parent_id: 'b' },
  ]

  it('nests sub-lanes under their parent, in order', () => {
    const tree = buildLaneTree(lanes)
    expect(tree.map(l => l.id)).toEqual(['a', 'b'])
    expect(tree[1].children.map(c => c.id)).toEqual(['b1', 'b2'])
  })

  it('surfaces an orphan rather than dropping it', () => {
    const tree = buildLaneTree([...lanes, { id: 'z', name: 'Lost', parent_id: 'gone', sort_order: 9 }])
    expect(tree.map(l => l.id)).toContain('z')
  })

  it('derives a readable title colour from the tint', () => {
    expect(laneStyle('#eff6ff').text).toBe('#1e40af')
    expect(laneStyle('#nonsense').text).toBe(laneStyle('#f8fafc').text)  // falls back, never undefined
  })

  it('merges milestones and activities into one ordered row set', () => {
    const rows = rowsForLane('a',
      [{ id: 'm1', lane_id: 'a', name: 'Go-Live', milestone_date: '2026-09-01', sort_order: 1 }],
      [{ id: 'p1', lane_id: 'a', name: 'Build', starts_on: '2026-07-01', ends_on: '2026-08-01', sort_order: 0 }])
    expect(rows.map(r => r.id)).toEqual(['p1', 'm1'])
    expect(rows[0].table).toBe('project_pathways')
    expect(rows[1].table).toBe('project_milestones')
  })

  it('flags an activity missing either date as undated', () => {
    const [row] = rowsForLane('a', [], [{ id: 'p', lane_id: 'a', name: 'X', starts_on: '2026-07-01', ends_on: null }])
    expect(row.undated).toBe(true)
  })
})

describe('shared timeline lines', () => {
  const band = { id: 'b', name: 'Build', starts_on: '2026-07-27', ends_on: '2026-11-02', sort_order: 0 }
  const point = { id: 'g', name: 'Go-Live', milestone_date: '2026-12-01', sort_order: 0 }
  const other = { id: 's', name: 'System Test', starts_on: '2026-11-01', ends_on: '2026-12-03', sort_order: 1 }

  it('puts items sharing a sort_order on one line', () => {
    const rows = groupLaneRows([band, point, other])
    expect(rows).toHaveLength(2)
    expect(rows[0].items.map(i => i.id)).toEqual(['b', 'g'])
    expect(rows[0].label).toBe('Build · Go-Live')
    expect(rows[1].items.map(i => i.id)).toEqual(['s'])
  })

  it('draws bands before points so a marker sits on top of its band', () => {
    const [row] = groupLaneRows([point, band])
    expect(row.ordered.map(i => i.id)).toEqual(['b', 'g'])
  })

  it('orders lines by sort_order, not insertion', () => {
    expect(groupLaneRows([other, band]).map(r => r.sort_order)).toEqual([0, 1])
  })

  it('treats a missing sort_order as line zero', () => {
    const [row] = groupLaneRows([{ id: 'x', name: 'X' }, { id: 'y', name: 'Y', sort_order: 0 }])
    expect(row.items).toHaveLength(2)
  })
})

describe('clampPct', () => {
  it('keeps a fill from ever exceeding its bar', () => {
    expect(clampPct(140)).toBe(100)
    expect(clampPct(-20)).toBe(0)
    expect(clampPct('62.4')).toBe(62)
    expect(clampPct(undefined)).toBe(0)
  })
})

describe('fuzzy entity matching (did you mean)', () => {
  const cands = [
    { id: 'c1', name: 'Meridian Water Corporation (Demo)' },
    { id: 'c2', name: 'Horizon Power' },
    { id: 'p1', name: 'Customer Billing Transformation' },
  ]

  it('catches a one-character typo', () => {
    const hit = fuzzyEntityMatch('how is Merdian tracking', cands)
    expect(hit.entity.id).toBe('c1')
    expect(hit.typed).toBe('merdian')
  })

  it('catches a transposition', () => {
    expect(fuzzyEntityMatch('Horzion Power progress', cands).entity.id).toBe('c2')
  })

  it('returns nothing when the name is spelled correctly', () => {
    expect(fuzzyEntityMatch('how is Meridian tracking', cands)).toBeNull()
  })

  it('does not guess from unrelated words', () => {
    expect(fuzzyEntityMatch('what is at risk this week', cands)).toBeNull()
  })

  it('ignores short words that would match almost anything', () => {
    expect(fuzzyEntityMatch('how is it', cands)).toBeNull()
  })
})

describe('resolveScope · did you mean', () => {
  const data = {
    clients: [{ id: 'c1', name: 'Meridian Water Corporation (Demo)' }],
    projRollup: [{ id: 'p1', name: 'Customer Billing Transformation', client_id: 'c1' }],
  }

  it('suggests the client when the name is misspelled', () => {
    const s = resolveScope('how is Merdian tracking', {}, data)
    expect(s.client).toBeNull()
    expect(s.didYouMean).toMatchObject({ name: 'Meridian Water Corporation (Demo)', kind: 'client' })
  })

  it('adds no suggestion when the name resolves exactly', () => {
    const s = resolveScope('how is Meridian Water Corporation (Demo) tracking', {}, data)
    expect(s.client?.id).toBe('c1')
    expect(s.didYouMean).toBeNull()
  })
})

describe('partial name matching', () => {
  const data = {
    clients: [
      { id: 'c1', name: 'Meridian Water Corporation (Demo)' },
      { id: 'c2', name: 'Horizon Power' },
      { id: 'c3', name: 'Western Power' },
    ],
    projRollup: [
      { id: 'p1', name: 'Customer Billing Transformation', client_id: 'c1' },
      { id: 'p2', name: 'RSR Program', client_id: 'c2' },
      { id: 'p3', name: 'My First Project', client_id: 'c2' },
      { id: 'p4', name: 'My First Project', client_id: 'c3' },
    ],
  }

  it('scopes on a short form of the client name', () => {
    const s = resolveScope('How is Meridian tracking', {}, data)
    expect(s.client?.id).toBe('c1')
    expect(s.suffix).toBe(' · Meridian Water Corporation (Demo)')
  })

  it('scopes on a short form of a project name', () => {
    expect(resolveScope('show me the Billing timeline', {}, data).proj?.id).toBe('p1')
  })

  it('will not guess from a word several candidates share', () => {
    // "Power" belongs to both Horizon and Western — it identifies neither.
    const s = resolveScope('how is Power tracking', {}, data)
    expect(s.client).toBeNull()
    expect(s.proj).toBeNull()
  })

  it('refuses to pick between two projects with the same name', () => {
    // Two clients each have "My First Project" — answering about either would be a guess.
    const s = resolveScope('how is My First Project going', {}, data)
    expect(s.proj).toBeNull()
    expect(s.ambiguous?.map(x => x.id).sort()).toEqual(['p3', 'p4'])
  })

  it('still prefers an exact full-name match', () => {
    expect(resolveScope('progress for Horizon Power', {}, data).client?.id).toBe('c2')
  })
})

describe('buildProgrammeStory', () => {
  const base = {
    projectName: 'Customer Billing Transformation', clientName: 'Meridian Water',
    today: new Date('2026-07-20T00:00:00'),
    pct: 53,
    phases: [{ name: 'Diagnose', pct: 100 }, { name: 'Design', pct: 100 }, { name: 'Engage', pct: 50 }, { name: 'Embed', pct: 0 }],
    trend: { perWeek: 3.6, verdict: 'on_track', forecast: new Date('2026-10-12T00:00:00'), slipDays: -12 },
    milestones: [{ name: 'Business readiness gate', date: '2027-01-29' }],
    atRisk: [{ name: 'Engage', pct: 50 }],
    heat: { rows: [
      { label: 'Billing Operations', cells: ['vh', 'vh', 'h', 'h'] },
      { label: 'Finance', cells: ['l', 'h', 'm', 'l'] },
    ], commentary: 'Billing absorbs it end to end.' },
    gate: { gate_name: 'Go-live readiness', decision_due: '2027-01-29', units: [
      { unit: 'Billing Operations', status: 'ready' },
      { unit: 'Contact Centre', status: 'at_risk', open: 'Scripts blocked on vendor' },
      { unit: 'Information & Technology', status: 'not_assessed' },
    ] },
    comms: { items: [{ message: 'Training reminder', status: 'blocked' }, { message: 'Day one', status: 'planned' }] },
    issues: {
      issues: [
        { ref: 'I-014', severity: 'high', status: 'open', title: 'Scripts blocked', detail: 'Vendor has not returned flows.', owner: 'S. Whitcombe' },
        { ref: 'I-009', severity: 'high', status: 'resolved', title: 'Old thing', detail: 'done', owner: 'D. Okafor' },
      ],
      decisions: [{ title: 'Hypercare staffing', detail: 'Floor-walking vs hotline.', status: 'pending', owner: 'P. Raman' }],
    },
  }

  it('leads with where the programme actually is', () => {
    const s = buildProgrammeStory(base)
    expect(s.sections[0].heading).toBe('Where we are')
    expect(s.sections[0].body).toContain('53% complete** on activities')
    expect(s.sections[0].body).toContain('2 of 4 phases fully closed')
    expect(s.sections[0].body).toContain('Engage')
  })

  it('counts only OPEN issues as being in the way', () => {
    const s = buildProgrammeStory(base)
    const body = s.sections.find(x => x.heading === 'What is in the way').body
    expect(body).toContain('1 open issue')      // the resolved one is excluded
    expect(body).toContain('Scripts blocked')
    expect(body).toContain('1 communication is blocked')
  })

  it('never counts an unassessed unit as ready', () => {
    const s = buildProgrammeStory(base)
    const body = s.sections.find(x => x.heading === 'Are we ready').body
    expect(body).toContain('1 of 3')
    expect(body).toContain('not been assessed')
  })

  it('surfaces pending decisions, not agreed ones', () => {
    const s = buildProgrammeStory(base)
    const body = s.sections.find(x => x.heading === 'What needs a decision').body
    expect(body).toContain('Hypercare staffing')
  })

  it('names what is missing instead of padding the story', () => {
    const s = buildProgrammeStory({ ...base, heat: null, gate: null, issues: null, trend: null })
    expect(s.gaps).toEqual(expect.arrayContaining([
      'not enough history to compute velocity', 'no issues log', 'no impact assessment', 'no readiness gate',
    ]))
    expect(s.sections.find(x => x.heading === 'Who it lands on')).toBeUndefined()
    expect(renderStory(s)).toContain("Not covered, because the data isn't there yet")
  })
})

describe('buildProgrammeStory · forecast sanity', () => {
  const base = {
    projectName: 'X', pct: 53, phases: [{ name: 'A', pct: 100 }, { name: 'B', pct: 20 }],
    today: new Date('2026-07-20T00:00:00'), plannedEnd: '2027-02-26',
  }

  it('refuses to report a finish date earlier than the plan still runs', () => {
    // Activity burn-down is fast early and slow late; extrapolating it linearly
    // "finishes" before phases that have not started are even scheduled to.
    const s = buildProgrammeStory({ ...base, trend: { perWeek: 5.5, verdict: 'on_track', forecast: new Date('2026-09-07T00:00:00'), slipDays: -172 } })
    const body = s.sections.find(x => x.heading === 'Which way it is moving').body
    expect(body).toContain('5.5%/week')
    expect(body).not.toContain('Sep 7')
    expect(body).toContain('health signal rather than a finish date')
  })

  it('reports a forecast that lands after the plan, with the slip', () => {
    const forecast = new Date('2027-05-01T00:00:00')
    const s = buildProgrammeStory({ ...base, trend: { perWeek: 0.9, verdict: 'slipping', forecast, slipDays: 64 } })
    const body = s.sections.find(x => x.heading === 'Which way it is moving').body
    // Format the expectation the same way the code does. Asserting a literal
    // "May 1, 2027" passes in en-US and fails in en-AU, which says nothing about
    // whether the forecast logic is right.
    const expected = forecast.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
    expect(body).toContain(expected)
    expect(body).toContain('64 days past')
  })
})
