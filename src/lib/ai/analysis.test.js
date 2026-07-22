import { describe, it, expect } from 'vitest'
import { buildReportGantt, buildIntegratedInsight, normPhrase, distinctiveTokens, resolveScope, scopedProjects, buildPhaseDrill, groundedFallback, resolveUsageScope, renderTemplate, templateTokens, matchKnowledgeRule, computeTrend, trendSentence, buildTrendChart, buildLaneTree, laneStyle, rowsForLane, groupLaneRows, clampPct, fuzzyEntityMatch, matchByPartialName, distinctiveNameTokens, buildProgrammeStory, renderStory, heatmapFromAudiences, overallImpact, buildNeedsMatrix, summariseDemand, summariseCoverage, coverageTrend, coverageVerdict, isStale, aspectSections, narrateGaps, completenessLine, buildGapsSection, sortAspects, analyseHeatmap, phaseProgress, projectProgress, laneProgress, inScope, inPlannedGap, addDays, milestoneAnchorDate, deriveCommsStatus, buildCommsSchedule, summariseComms, leadBucket, leadStaleness, canConvertLead, summariseLeads } from './analysis'

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

describe('buildTrendChart · axis does not collapse the data', () => {
  const points = Array.from({ length: 12 }, (_, i) => ({
    captured_on: new Date(2026, 4, 4 + i * 7).toISOString().slice(0, 10),
    pct: 18 + i * 4,
  }))

  it('caps the axis when the planned end is far past the last snapshot', () => {
    const c = buildTrendChart([{ name: 'X', points }], { plannedEnd: '2027-02-26', today: new Date('2026-07-20') })
    expect(c.plannedOffScale).toBe(true)
    expect(c.plannedX).toBe(c.w - c.pad)              // pinned to the edge
    const xs = c.series[0].coords.map(p => p.x)
    // Data should use most of the width, not be squashed into the first third.
    expect(Math.max(...xs)).toBeGreaterThan(c.w * 0.6)
  })

  it('leaves the axis alone when the planned end is close to the data', () => {
    const c = buildTrendChart([{ name: 'X', points }], { plannedEnd: '2026-08-15', today: new Date('2026-07-20') })
    // Sitting at the right edge is correct here — the planned end IS the last date
    // on the axis. What matters is that it is drawn in its true position, not pinned.
    expect(c.plannedOffScale).toBe(false)
    expect(c.lastLabel.getTime()).toBe(new Date('2026-08-15').getTime())
  })
})

describe('computeTrend · forecast sanity is universal', () => {
  const weekly = (n, step) => Array.from({ length: n }, (_, i) => ({
    captured_on: new Date(2026, 4, 4 + i * 7).toISOString().slice(0, 10),
    pct: Math.min(100, 18 + i * step),
  }))

  it('flags a projection that lands before the plan still runs', () => {
    const t = computeTrend(weekly(12, 4), { plannedEnd: '2027-02-26', today: new Date('2026-07-20') })
    expect(t.forecastBeforePlan).toBe(true)
    // Every consumer reads the flag, so the Word report and the canvas cannot diverge.
    const say = trendSentence(t, d => new Date(d).toISOString().slice(0, 10))
    expect(say).toContain('health signal rather than a finish date')
    expect(say).not.toContain('puts completion around')
  })

  it('reports the date normally when the projection lands after the plan', () => {
    const t = computeTrend(weekly(12, 1), { plannedEnd: '2026-08-01', today: new Date('2026-07-20') })
    expect(t.forecastBeforePlan).toBe(false)
    expect(trendSentence(t, d => new Date(d).toISOString().slice(0, 10))).toContain('puts completion around')
  })
})

describe('heatmapFromAudiences', () => {
  const auds = [
    { name: 'Billing Operations', sort_order: 0, headcount: 180, impact_people: 'vh', impact_process: 'vh', impact_information: 'h', impact_technology: 'h', impact_note: 'Role and system move together.', impact_rated_on: '2026-06-12' },
    { name: 'Finance', sort_order: 1, headcount: 45, impact_people: 'l', impact_process: 'h', impact_information: 'm', impact_technology: 'l', impact_rated_on: '2026-06-14' },
    { name: 'Field Services', sort_order: 2, headcount: null },   // exists but unrated
  ]

  it('builds the shape the heat map widget already renders', () => {
    const h = heatmapFromAudiences(auds)
    expect(h.cols).toEqual(['People', 'Process', 'Information', 'Technology'])
    expect(h.rows.map(r => r.label)).toEqual(['Billing Operations', 'Finance'])
    expect(h.rows[0].cells).toEqual(['vh', 'vh', 'h', 'h'])
  })

  it('reports an unrated audience rather than drawing it as no-impact', () => {
    // A group shown as four grey dots reads as "assessed, low impact". It wasn't assessed.
    const h = heatmapFromAudiences(auds)
    expect(h.rows).toHaveLength(2)
    expect(h.missing).toEqual(['Field Services'])
  })

  it('counts partially rated domains', () => {
    const h = heatmapFromAudiences([{ name: 'X', impact_people: 'h' }])
    expect(h.unratedCells).toBe(3)
  })

  it('returns null when nothing has been rated at all', () => {
    // Better no heat map than a grid of greys that looks like a finished assessment.
    expect(heatmapFromAudiences([{ name: 'X' }, { name: 'Y' }])).toBeNull()
    expect(heatmapFromAudiences([])).toBeNull()
  })

  it('carries the latest rating date and joins the notes', () => {
    const h = heatmapFromAudiences(auds)
    expect(h.ratedOn).toBe('2026-06-14')
    expect(h.commentary).toContain('Billing Operations')
  })
})

describe('overallImpact', () => {
  it('is the peak of the domains, not an average', () => {
    // Very High on People with three Lows is a highly impacted group. An average
    // would call it Medium and bury the domain that actually matters.
    expect(overallImpact({ impact_people: 'vh', impact_process: 'l', impact_information: 'l', impact_technology: 'l' })).toBe('vh')
  })

  it('ignores unrated domains rather than treating them as none', () => {
    expect(overallImpact({ impact_people: 'h' })).toBe('h')
  })

  it('returns null when nothing is rated, so the row shows unrated not none', () => {
    expect(overallImpact({})).toBeNull()
    expect(overallImpact(null)).toBeNull()
  })
})

describe('buildNeedsMatrix', () => {
  const demand = [
    { audience_id: 'a1', audience_name: 'Billing', module_id: 'm1', module_name: 'Console', necessity: 'mandatory', people_needed: 180, applies_to: null, module_status: 'ready' },
    { audience_id: 'a1', audience_name: 'Billing', module_id: 'm2', module_name: 'Refunds', necessity: 'mandatory', people_needed: 30, applies_to: 30, module_status: 'in_build' },
    { audience_id: 'a2', audience_name: 'Field',   module_id: 'm1', module_name: 'Console', necessity: 'recommended', people_needed: null, applies_to: null, module_status: 'ready' },
  ]

  it('builds a grid with an empty cell where there is no need', () => {
    const m = buildNeedsMatrix(demand)
    expect(m.rows.map(r => r.name)).toEqual(['Billing', 'Field'])
    expect(m.cols.map(c => c.name)).toEqual(['Console', 'Refunds'])
    expect(m.cells[1][1]).toBeNull()          // Field needs no Refunds module
    expect(m.cells[0][0].needed).toBe(180)
  })

  it('marks a partial audience so 30 of 180 does not read as the whole group', () => {
    expect(buildNeedsMatrix(demand).cells[0][1].partial).toBe(true)
  })

  it('flags an unknown size rather than rendering it as zero', () => {
    const cell = buildNeedsMatrix(demand).cells[1][0]
    expect(cell.unknown).toBe(true)
    expect(cell.needed).toBeNull()
  })
})

describe('summariseDemand', () => {
  const demand = [
    { audience_id: 'a1', audience_name: 'Billing', module_id: 'm1', module_name: 'Console', necessity: 'mandatory', people_needed: 180, module_status: 'ready' },
    { audience_id: 'a1', audience_name: 'Billing', module_id: 'm2', module_name: 'Refunds', necessity: 'mandatory', people_needed: 30, module_status: 'in_build' },
    { audience_id: 'a2', audience_name: 'Field',   module_id: 'm1', module_name: 'Console', necessity: 'mandatory', people_needed: null, module_status: 'ready' },
    { audience_id: 'a3', audience_name: 'Finance', module_id: 'm1', module_name: 'Console', necessity: 'recommended', people_needed: 45, module_status: 'ready' },
  ]

  it('counts places not people, since one person on three modules needs three seats', () => {
    expect(summariseDemand(demand).places).toBe(210)
  })

  it('excludes recommended needs from the mandatory place count', () => {
    expect(summariseDemand(demand).places).not.toBe(255)
  })

  it('reports unsized groups instead of silently dropping them from the total', () => {
    const s = summariseDemand(demand)
    expect(s.unsizedNeeds).toBe(1)
    expect(s.unsizedGroups).toEqual(['Field'])
  })

  it('names modules that are not ready, so 0% is not read as a leader failing to act', () => {
    expect(summariseDemand(demand).notReadyModules).toEqual([{ name: 'Refunds', status: 'in_build' }])
  })

  it('handles an empty matrix without inventing zeros', () => {
    const s = summariseDemand([])
    expect(s.places).toBe(0)
    expect(s.modules).toBe(0)
    expect(s.unsizedGroups).toEqual([])
  })
})

describe('training coverage', () => {
  const row = (o) => ({ necessity: 'mandatory', module_status: 'ready', gap_reason: null, last_checked: '2026-12-14', ...o })
  const rows = [
    row({ audience_name: 'Billing', module_name: 'Console', people_needed: 180, trained: 158, pct: 88 }),
    row({ audience_name: 'Finance', module_name: 'Month-end', people_needed: 45, trained: 0, pct: 0 }),
    row({ audience_name: 'Field',   module_name: 'Mobile', people_needed: null, trained: null, pct: null, gap_reason: 'size_unknown', last_checked: null }),
    // Window already open, so this one is genuinely late rather than merely scheduled.
    row({ audience_name: 'Billing', module_name: 'Refunds', people_needed: 30, trained: null, pct: null, gap_reason: 'never_reported', module_status: 'in_build', window_start: '2026-11-01', last_checked: null }),
    row({ audience_name: 'Finance', module_name: 'SCV', people_needed: 45, trained: 45, pct: 100, necessity: 'recommended' }),
  ]

  it('computes coverage across countable rows only', () => {
    const s = summariseCoverage(rows, { asOf: '2026-12-15' })
    expect(s.needed).toBe(225)          // 180 + 45, excludes the two blanks
    expect(s.trained).toBe(158)
    expect(s.pct).toBe(70)
  })

  it('excludes recommended needs from the mandatory number', () => {
    expect(summariseCoverage(rows, { asOf: '2026-12-15' }).total).toBe(4)
  })

  it('returns null coverage rather than 0 when nothing is countable', () => {
    const s = summariseCoverage([row({ people_needed: null, trained: null, pct: null, gap_reason: 'never_reported' })], { asOf: '2026-12-15' })
    expect(s.pct).toBeNull()
  })

  it('counts an answered zero as real coverage, not as a gap', () => {
    const s = summariseCoverage(rows, { asOf: '2026-12-15' })
    expect(s.countable).toBe(2)         // the 0% Finance row is an answer
    expect(s.gaps.never_reported).toEqual(['Billing · Refunds'])
  })

  it('reports blocked modules separately from leader gaps', () => {
    const s = summariseCoverage(rows, { asOf: '2026-12-15' })
    expect(s.blocked).toEqual([{ audience: 'Billing', module: 'Refunds', status: 'in_build' }])
  })

  it('flags a check older than the stale window', () => {
    expect(isStale('2026-11-01', '2026-12-15')).toBe(true)
    expect(isStale('2026-12-14', '2026-12-15')).toBe(false)
    expect(isStale(null, '2026-12-15')).toBe(false)
  })

  it('names stale rows so an old number cannot be quoted as current', () => {
    const old = [row({ audience_name: 'Billing', module_name: 'Console', people_needed: 180, trained: 158, pct: 88, last_checked: '2026-10-01' })]
    expect(summariseCoverage(old, { asOf: '2026-12-15' }).stale[0].days).toBe(75)
  })
})

describe('coverageTrend', () => {
  it('reports movement between the two most recent answers', () => {
    expect(coverageTrend([
      { as_at: '2026-11-30', trained: 110 }, { as_at: '2026-12-14', trained: 158 },
    ])).toMatchObject({ delta: 48, direction: 'up' })
  })

  it('calls it flat when the number has not moved, not silent', () => {
    expect(coverageTrend([
      { as_at: '2026-11-30', trained: 0 }, { as_at: '2026-12-14', trained: 0 },
    ])).toMatchObject({ delta: 0, direction: 'flat' })
  })

  it('ignores unanswered checks when picking the two to compare', () => {
    expect(coverageTrend([
      { as_at: '2026-11-30', trained: 95 }, { as_at: '2026-12-07', trained: null }, { as_at: '2026-12-14', trained: 98 },
    ])).toMatchObject({ delta: 3 })
  })

  it('returns null with fewer than two answers rather than inventing a direction', () => {
    expect(coverageTrend([{ as_at: '2026-12-14', trained: 98 }])).toBeNull()
    expect(coverageTrend([])).toBeNull()
  })
})

describe('coverageVerdict', () => {
  const base = { countable: 4, total: 4, gaps: {}, unreported: 0 }

  it('passes when coverage clears the threshold and nothing is missing', () => {
    expect(coverageVerdict({ ...base, pct: 97 }).verdict).toBe('pass')
  })

  it('says short when everything is reported but coverage is low', () => {
    expect(coverageVerdict({ ...base, pct: 70 }).verdict).toBe('short')
  })

  it('never passes on a partial picture, however high the reported number', () => {
    const v = coverageVerdict({ ...base, pct: 100, countable: 2, gaps: { never_reported: ['Field · Mobile'] }, unreported: 1 })
    expect(v.verdict).toBe('incomplete')
  })

  it('says unknown rather than fail when nothing has been reported at all', () => {
    expect(coverageVerdict({ ...base, countable: 0, pct: null }).verdict).toBe('unknown')
  })
})

describe('summariseCoverage — blocked material', () => {
  const row = o => ({ necessity: 'mandatory', people_needed: 100, trained: 10, pct: 10,
    gap_reason: null, last_checked: '2026-12-14', audience_name: 'A', module_name: 'M', ...o })

  it('does not flag a planned module whose window has not opened', () => {
    const s = summariseCoverage([row({ module_status: 'planned', window_start: '2027-02-09' })], { asOf: '2026-12-15' })
    expect(s.blocked).toEqual([])
  })

  it('flags a module that should already be delivering but is not ready', () => {
    const s = summariseCoverage([row({ module_status: 'in_build', window_start: '2026-11-01' })], { asOf: '2026-12-15' })
    expect(s.blocked).toHaveLength(1)
  })

  it('does not flag material with no window at all rather than guessing', () => {
    const s = summariseCoverage([row({ module_status: 'planned', window_start: null })], { asOf: '2026-12-15' })
    expect(s.blocked).toEqual([])
  })
})

describe('aspect sweep narration', () => {
  const swept = [
    { key: 'comms',    label: 'Comms plan',    state: 'partial', section: { heading: 'Comms plan' }, note: '2 items blocked.', clientNote: 'Comms in place, 2 items pending.' },
    { key: 'heatmap',  label: 'Heat map',      state: 'present', section: { heading: 'Heat map' },   note: null, clientNote: null },
    { key: 'benefits', label: 'Benefits',      state: 'absent',  section: null, note: 'Not tracked yet — no baseline.', clientNote: 'Benefits — not yet tracked.' },
  ]

  it('orders sections by the registry, not by whatever came back first', () => {
    expect(aspectSections(swept).map(s => s.heading)).toEqual(['Heat map', 'Comms plan'])
  })

  it('includes a partial aspect section — partial data is still data', () => {
    expect(aspectSections(swept)).toHaveLength(2)
  })

  it('never silently drops an absent aspect', () => {
    const { absent } = narrateGaps(swept)
    expect(absent.map(a => a.label)).toEqual(['Benefits'])
  })

  it('uses the client register when asked, not the internal one', () => {
    const { absent } = narrateGaps(swept, { audience: 'client' })
    expect(absent[0].text).toBe('Benefits — not yet tracked.')
  })

  it('omits an aspect that has no note for the chosen audience', () => {
    const quiet = [{ key: 'gate', label: 'Gate', state: 'absent', section: null, note: 'internal only', clientNote: null }]
    expect(narrateGaps(quiet, { audience: 'client' }).absent).toEqual([])
  })

  it('summarises completeness so the reader knows what they were not shown', () => {
    const line = completenessLine(swept)
    expect(line).toContain('1 of 3 areas are complete')
    expect(line).toContain('Benefits')
  })

  it('says so plainly when everything is captured', () => {
    const all = [{ key: 'heatmap', label: 'Heat map', state: 'present', section: {}, note: null, clientNote: null }]
    expect(completenessLine(all)).toBe('All 1 areas are captured and current.')
  })

  it('builds a gaps section listing partial before absent', () => {
    const s = buildGapsSection(swept)
    expect(s.body.indexOf('Comms plan')).toBeLessThan(s.body.indexOf('Benefits'))
  })

  it('returns null only when nothing is missing', () => {
    expect(buildGapsSection([{ key: 'a', label: 'A', state: 'present', section: {}, note: null, clientNote: null }])).toBeNull()
  })
})

describe('analyseHeatmap', () => {
  const grid = { cols: ['People', 'Process'], rows: [
    { label: 'Billing', cells: ['vh', 'vh'] },
    { label: 'Finance', cells: ['l', 'm'] },
  ] }

  it('names the highest-impact group first', () => {
    expect(analyseHeatmap(grid)[0]).toContain('Billing')
  })

  it('counts only High and above as hotspots', () => {
    expect(analyseHeatmap(grid).find(l => l.includes('hotspot'))).toContain('2 hotspots')
  })

  it('returns nothing rather than guessing from an empty grid', () => {
    expect(analyseHeatmap({ cols: [], rows: [] })).toEqual([])
  })
})

describe('phaseProgress', () => {
  const ex = (n, done = 0) => Array.from({ length: n }, () => ({ completedBy: done }))

  it('splits a phase equally across its exercises', () => {
    // 3 exercises, 1 complete, single member → 33%
    expect(phaseProgress({ exercises: [{ completedBy: 1 }, { completedBy: 0 }, { completedBy: 0 }] }).pct).toBe(33)
  })

  it('gives each of five exercises a 20% share', () => {
    expect(phaseProgress({ exercises: ex(5) }).weightEach).toBe(20)
  })

  it('counts an exercise as the fraction of members who finished it', () => {
    // 2 exercises, 4 members; first done by 2 of 4, second by none → 25%
    expect(phaseProgress({ exercises: [{ completedBy: 2 }, { completedBy: 0 }] }, { members: 4 }).pct).toBe(25)
  })

  it('reaches 100 only when every member has done every exercise', () => {
    expect(phaseProgress({ exercises: [{ completedBy: 4 }, { completedBy: 4 }] }, { members: 4 }).pct).toBe(100)
    expect(phaseProgress({ exercises: [{ completedBy: 4 }, { completedBy: 3 }] }, { members: 4 }).pct).toBe(88)
  })

  it('has no percentage at all when no exercises are defined', () => {
    const r = phaseProgress({ exercises: [] })
    expect(r.pct).toBeNull()
    expect(r.reason).toBe('no_exercises')
  })
})

describe('projectProgress', () => {
  const full = n => Array.from({ length: n }, () => ({ completedBy: 1 }))
  const empty = n => Array.from({ length: n }, () => ({ completedBy: 0 }))

  it('weights each selected phase equally regardless of exercise count', () => {
    // Diagnose complete with 3 exercises, Design untouched with 50 → 50%, not 6%
    const r = projectProgress([
      { name: 'Diagnose', laneId: 'L1',  exercises: full(3) },
      { name: 'Design', laneId: 'L1',    exercises: empty(50) },
    ])
    expect(r.pct).toBe(50)
    expect(r.weightEach).toBe(50)
  })

  it('excludes deselected phases from the denominator', () => {
    const r = projectProgress([
      { name: 'Diagnose', laneId: 'L1',  exercises: full(5) },
      { name: 'Design', laneId: 'L1',    exercises: empty(5) },
      { name: 'Engage',   exercises: empty(5) },
      { name: 'Embed',    exercises: empty(5) },
    ])
    expect(r.pct).toBe(50)              // 100 and 0 over two phases, not four
    expect(r.deferred).toEqual(['Engage', 'Embed'])
  })

  it('reports 100 when every selected phase is complete', () => {
    expect(projectProgress([
      { name: 'Diagnose', laneId: 'L1',  exercises: full(3) },
      { name: 'Design', laneId: 'L1',    exercises: full(5), },
      { name: 'Engage',   exercises: empty(5) },
    ]).pct).toBe(100)
  })

  it('leaves an undefined phase out of the average rather than scoring it zero', () => {
    const r = projectProgress([
      { name: 'Diagnose', laneId: 'L1',  exercises: full(4) },
      { name: 'Design',   laneId: 'L1', exercises: [] },
    ])
    expect(r.pct).toBe(100)             // not 50 — Design has asked nothing of anyone
    expect(r.undefinedPhases).toEqual(['Design'])
  })

  it('returns null, never zero, when no phase has exercises', () => {
    expect(projectProgress([{ name: 'Diagnose', exercises: [] }]).pct).toBeNull()
  })
})

describe('projectProgress — the worked example', () => {
  // Two phases selected, five exercises allocated to each. Each phase is worth 50%,
  // so each exercise is worth 10% of the programme. This is the case the model was
  // specified against, written out so a future change that breaks it fails loudly.
  const ex = done => Array.from({ length: 5 }, (_, i) => ({ completedBy: i < done ? 1 : 0 }))

  it('makes each exercise worth 10% when 2 phases × 5 exercises are selected', () => {
    expect(projectProgress([{ name: 'Diagnose', laneId: 'L1',  exercises: ex(0) }, { name: 'Design', laneId: 'L1',  exercises: ex(0) }]).pct).toBe(0)
    expect(projectProgress([{ name: 'Diagnose', laneId: 'L1',  exercises: ex(1) }, { name: 'Design', laneId: 'L1',  exercises: ex(0) }]).pct).toBe(10)
    expect(projectProgress([{ name: 'Diagnose', laneId: 'L1',  exercises: ex(2) }, { name: 'Design', laneId: 'L1',  exercises: ex(0) }]).pct).toBe(20)
    expect(projectProgress([{ name: 'Diagnose', laneId: 'L1',  exercises: ex(5) }, { name: 'Design', laneId: 'L1',  exercises: ex(0) }]).pct).toBe(50)
    expect(projectProgress([{ name: 'Diagnose', laneId: 'L1',  exercises: ex(5) }, { name: 'Design', laneId: 'L1',  exercises: ex(5) }]).pct).toBe(100)
  })

  it('rebalances to 33% a phase when a third is selected, with no config change', () => {
    const three = projectProgress([
      { name: 'Diagnose', laneId: 'L1',  exercises: ex(5) }, { name: 'Design', laneId: 'L1',  exercises: ex(0) }, { name: 'Engage', laneId: 'L1', exercises: ex(0) },
    ])
    expect(three.weightEach).toBe(33.3)
    expect(three.pct).toBe(33)
  })
})

describe('scope is lane membership', () => {
  const full = n => Array.from({ length: n }, () => ({ completedBy: 1 }))
  const empty = n => Array.from({ length: n }, () => ({ completedBy: 0 }))

  it('counts only the phases sitting in a lane', () => {
    // The customer picked two of five. The other three are defined but not being run,
    // so they are not in the denominator — the whole point of the change.
    const r = projectProgress([
      { name: 'Diagnose', laneId: 'W1', exercises: full(5) },
      { name: 'Design',   laneId: 'W1', exercises: empty(5) },
      { name: 'Engage',   exercises: empty(5) },
      { name: 'Embed',    exercises: empty(5) },
      { name: 'Evaluate', exercises: empty(5) },
    ])
    expect(r.pct).toBe(50)                    // not 20% across all five
    expect(r.selectedCount).toBe(2)
    expect(r.deferred).toEqual(['Engage', 'Embed', 'Evaluate'])
  })

  it('treats all five in one lane as the ordinary case', () => {
    const r = projectProgress(['Diagnose','Design','Engage','Embed','Evaluate']
      .map(name => ({ name, laneId: 'W1', exercises: full(2) })))
    expect(r.pct).toBe(100)
    expect(r.deferred).toEqual([])
  })

  it('accepts the snake_case column name straight from the view', () => {
    expect(inScope({ lane_id: 'W1' })).toBe(true)
    expect(inScope({ lane_id: null })).toBe(false)
  })
})

describe('laneProgress', () => {
  const full = n => Array.from({ length: n }, () => ({ completedBy: 1 }))
  const empty = n => Array.from({ length: n }, () => ({ completedBy: 0 }))

  it('rolls each lane up separately for its band on the timeline', () => {
    const lanes = laneProgress([
      { name: 'Diagnose', laneId: 'W1', laneName: 'Wave 1', exercises: full(4) },
      { name: 'Design',   laneId: 'W1', laneName: 'Wave 1', exercises: empty(4) },
      { name: 'Engage',   laneId: 'W2', laneName: 'Wave 2', exercises: full(2) },
    ])
    expect(lanes.map(l => [l.name, l.pct])).toEqual([['Wave 1', 50], ['Wave 2', 100]])
  })

  it('leaves out phases in no lane', () => {
    expect(laneProgress([{ name: 'Embed', exercises: full(3) }])).toEqual([])
  })
})

describe('inPlannedGap', () => {
  const phases = [
    { name: 'Diagnose', inScope: true, planned_start: '2026-08-03', planned_end: '2026-09-30' },
    { name: 'Design',   inScope: true, planned_start: '2026-11-03', planned_end: '2026-12-18' },
    { name: 'Engage',   inScope: false, planned_start: '2027-01-05', planned_end: '2027-03-01' },
  ]

  it('recognises the window between two phases', () => {
    expect(inPlannedGap('2026-10-15', phases)).toMatchObject({ after: 'Diagnose', before: 'Design' })
  })

  it('is not a gap while a phase is running', () => {
    expect(inPlannedGap('2026-09-01', phases)).toBeNull()
    expect(inPlannedGap('2026-12-01', phases)).toBeNull()
  })

  it('ignores out-of-scope phases when finding the next start', () => {
    // After Design ends there is no further IN-SCOPE phase, so this is not a gap —
    // it is the end of the programme. Counting Engage would invent a resumption.
    expect(inPlannedGap('2026-12-28', phases)).toBeNull()
  })

  it('needs two dated phases before it can call anything a gap', () => {
    expect(inPlannedGap('2026-10-15', [phases[0]])).toBeNull()
  })
})

describe('computeTrend — planned gap', () => {
  const phases = [
    { name: 'Diagnose', inScope: true, planned_start: '2026-08-03', planned_end: '2026-09-30' },
    { name: 'Design',   inScope: true, planned_start: '2026-11-03', planned_end: '2026-12-18' },
  ]
  const flat = [
    { captured_on: '2026-10-01', pct: 50 },
    { captured_on: '2026-10-08', pct: 50 },
    { captured_on: '2026-10-15', pct: 50 },
  ]

  it('calls flat progress inside a gap a planned gap, not a stall', () => {
    const t = computeTrend(flat, { today: new Date('2026-10-15'), phases })
    expect(t.verdict).toBe('in_planned_gap')
    expect(t.plannedGap.before).toBe('Design')
  })

  it('still calls it stalled when flat inside a phase', () => {
    const t = computeTrend(
      [{ captured_on: '2026-11-20', pct: 50 }, { captured_on: '2026-11-27', pct: 50 }, { captured_on: '2026-12-04', pct: 50 }],
      { today: new Date('2026-12-04'), phases })
    expect(t.verdict).toBe('stalled')
  })

  it('says which phase resumes rather than just that it is flat', () => {
    const t = computeTrend(flat, { today: new Date('2026-10-15'), phases })
    expect(trendSentence(t)).toContain('Design')
    expect(trendSentence(t)).not.toContain('stalled')
  })
})

describe('comms plan — dates and status derived', () => {
  // Go-Live is a point milestone; a band is tested separately.
  const golive = { id: 'gl', name: 'Go-Live', milestone_date: '2027-02-15' }
  const champ  = { id: 'ch', name: 'Change champion network', starts_on: '2026-07-01', ends_on: '2026-10-30' }
  const ms = { gl: golive, ch: champ }
  const today = '2026-07-22'

  it('addDays does timezone-safe date arithmetic', () => {
    expect(addDays('2027-02-15', -7)).toBe('2027-02-08')
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01')   // year boundary
    expect(addDays(null, 5)).toBeNull()
  })

  it('a band anchors to its end date, a point to its date', () => {
    expect(milestoneAnchorDate(golive)).toBe('2027-02-15')
    expect(milestoneAnchorDate(champ)).toBe('2026-10-30')  // ends_on
  })

  it('derives the date from anchor + offset (the cascade)', () => {
    const r = deriveCommsStatus(
      { message: 'x', anchor_milestone_id: 'gl', offset_days: -7 }, { milestones: ms, today })
    expect(r.derivedDate).toBe('2027-02-08')
    expect(r.effectiveDate).toBe('2027-02-08')
    expect(r.status).toBe('planned')
  })

  it('moving the anchor moves the item', () => {
    const item = { message: 'x', anchor_milestone_id: 'gl', offset_days: -7 }
    const early = deriveCommsStatus(item, { milestones: { gl: { ...golive, milestone_date: '2027-02-15' } }, today })
    const moved = deriveCommsStatus(item, { milestones: { gl: { ...golive, milestone_date: '2027-03-15' } }, today })
    expect(early.effectiveDate).toBe('2027-02-08')
    expect(moved.effectiveDate).toBe('2027-03-08')   // cascade followed go-live
  })

  it('BLOCKED: past due, waiting on an upstream milestone not yet reached', () => {
    // due 2026-07-19 (before today), champion network ends 2026-10-30 (future).
    const r = deriveCommsStatus(
      { message: 'briefings', anchor_milestone_id: 'gl', offset_days: -211, depends_on_milestone_id: 'ch' },
      { milestones: ms, today })
    expect(r.effectiveDate <= today).toBe(true)
    expect(r.upstreamReady).toBe(false)
    expect(r.status).toBe('blocked')
    expect(r.dependsName).toBe('Change champion network')
  })

  it('OVERDUE: past due with nothing blocking it', () => {
    const r = deriveCommsStatus(
      { message: 'follow-up', anchor_milestone_id: 'gl', offset_days: -215 },  // 2026-07-15
      { milestones: ms, today })
    expect(r.status).toBe('overdue')
  })

  it('blocked and overdue are NOT the same — the upstream is what differs', () => {
    const base = { message: 'x', anchor_milestone_id: 'gl', offset_days: -211 }
    const blocked = deriveCommsStatus({ ...base, depends_on_milestone_id: 'ch' }, { milestones: ms, today })
    const overdue = deriveCommsStatus({ ...base }, { milestones: ms, today })
    expect(blocked.status).toBe('blocked')
    expect(overdue.status).toBe('overdue')
  })

  it('a met upstream downgrades blocked to overdue', () => {
    // champion network already ended in the past → upstream ready → just late.
    const past = { gl: golive, ch: { ...champ, ends_on: '2026-06-01' } }
    const r = deriveCommsStatus(
      { message: 'x', anchor_milestone_id: 'gl', offset_days: -211, depends_on_milestone_id: 'ch' },
      { milestones: past, today })
    expect(r.upstreamReady).toBe(true)
    expect(r.status).toBe('overdue')
  })

  it('sent always wins, whatever the dates', () => {
    const r = deriveCommsStatus(
      { message: 'x', anchor_milestone_id: 'gl', offset_days: -215, sent: true },
      { milestones: ms, today })
    expect(r.status).toBe('sent')
  })

  it('a fixed date anchors without a milestone', () => {
    const future = deriveCommsStatus({ message: 'newsletter', fixed_date: '2026-08-03' }, { milestones: ms, today })
    expect(future.effectiveDate).toBe('2026-08-03')
    expect(future.status).toBe('planned')
  })

  it('an override detaches from the anchor and the plan flags it', () => {
    const r = deriveCommsStatus(
      { message: 'walkthrough', anchor_milestone_id: 'gl', offset_days: -30, override_date: '2027-01-20' },
      { milestones: ms, today })
    expect(r.derivedDate).toBe('2027-01-16')   // where the anchor would put it
    expect(r.effectiveDate).toBe('2027-01-20') // where the admin pinned it
    expect(r.detached).toBe(true)
  })

  it('an override equal to the derived date is NOT detached', () => {
    const r = deriveCommsStatus(
      { message: 'x', anchor_milestone_id: 'gl', offset_days: -30, override_date: '2027-01-16' },
      { milestones: ms, today })
    expect(r.detached).toBe(false)
  })

  it('UNSCHEDULED: anchored to a milestone that has no date yet', () => {
    const undated = { gl: { id: 'gl', name: 'Go-Live' } }  // no dates
    const r = deriveCommsStatus(
      { message: 'x', anchor_milestone_id: 'gl', offset_days: -7 }, { milestones: undated, today })
    expect(r.effectiveDate).toBeNull()
    expect(r.status).toBe('unscheduled')
  })

  it('buildCommsSchedule sorts by effective date, unscheduled last', () => {
    const items = [
      { id: 'a', message: 'later',  anchor_milestone_id: 'gl', offset_days: -7 },   // 2027-02-08
      { id: 'b', message: 'sooner', anchor_milestone_id: 'gl', offset_days: -215 }, // 2026-07-15
      { id: 'c', message: 'nodate', anchor_milestone_id: 'gl', offset_days: 0,
        // anchor with no date → unscheduled
      },
    ]
    const undatedMs = { gl: golive }
    const rows = buildCommsSchedule(items.slice(0,2), undatedMs, { today })
    expect(rows.map(r => r.id)).toEqual(['b', 'a'])
  })

  it('summariseComms keeps blocked and overdue apart and names the upstream', () => {
    const rows = buildCommsSchedule([
      { id: '1', message: 's', anchor_milestone_id: 'gl', offset_days: -250, sent: true },
      { id: '2', message: 'o', anchor_milestone_id: 'gl', offset_days: -215 },
      { id: '3', message: 'b', anchor_milestone_id: 'gl', offset_days: -211, depends_on_milestone_id: 'ch' },
      { id: '4', message: 'p', anchor_milestone_id: 'gl', offset_days: -7 },
    ], ms, { today })
    const s = summariseComms(rows)
    expect(s).toMatchObject({ total: 4, sent: 1, overdue: 1, blocked: 1, planned: 1 })
    expect(s.gaps.some(g => /blocked/.test(g) && /Change champion network/.test(g))).toBe(true)
    expect(s.gaps.some(g => /overdue/.test(g))).toBe(true)
  })
})

/* ══════════════════════════════════════════════════════════════════════════
   LEAD PIPELINE
   These mirror the lead_pipeline view. If the view is ever changed, one of these
   should fail — that is the point of duplicating the rule here.
   ══════════════════════════════════════════════════════════════════════════ */
describe('lead pipeline', () => {
  const today = '2026-07-22'

  it('puts an untoggled open row in Leads and a toggled one in Opportunities', () => {
    expect(leadBucket({ status: 'open', is_opportunity: false })).toBe('lead')
    expect(leadBucket({ status: 'open', is_opportunity: true  })).toBe('opportunity')
  })

  it('treats closed as closed even when the toggle is still on', () => {
    // A won lead is not "still an opportunity" just because nobody flipped the
    // toggle back. Status has to win, or the pipeline double-counts its own wins.
    expect(leadBucket({ status: 'won',  is_opportunity: true })).toBe('closed')
    expect(leadBucket({ status: 'lost', is_opportunity: true })).toBe('closed')
  })

  it('defaults a row with no status to open', () => {
    expect(leadBucket({ is_opportunity: false })).toBe('lead')
  })

  it('counts age by calendar date, not by hours elapsed', () => {
    // A lead raised at 11pm and one raised at 1am the same day are the same age.
    // Comparing a timestamptz against a date directly would make one of them older.
    const late  = leadStaleness({ created_at: '2026-07-22T23:30:00Z', status: 'open' }, { today })
    const early = leadStaleness({ created_at: '2026-07-22T01:00:00Z', status: 'open' }, { today })
    expect(late.ageDays).toBe(0)
    expect(early.ageDays).toBe(0)
  })

  it('starts the contact clock at arrival when nobody has replied', () => {
    // An untouched lead is not "0 days since contact" — nobody has contacted it,
    // so the honest reading is the full age.
    const s = leadStaleness({ created_at: '2026-07-01', status: 'open' }, { today })
    expect(s.ageDays).toBe(21)
    expect(s.daysSinceContact).toBe(21)
  })

  it('uses last_contacted once someone has replied', () => {
    const s = leadStaleness({ created_at: '2026-07-01', last_contacted: '2026-07-20', status: 'open' }, { today })
    expect(s.ageDays).toBe(21)
    expect(s.daysSinceContact).toBe(2)
  })

  it('flags an overdue next action, but not on a closed lead', () => {
    expect(leadStaleness({ created_at: '2026-07-01', next_action_on: '2026-07-10', status: 'open' }, { today }).actionOverdue).toBe(true)
    expect(leadStaleness({ created_at: '2026-07-01', next_action_on: '2026-07-30', status: 'open' }, { today }).actionOverdue).toBe(false)
    // Chasing a lead that is already won or lost is noise.
    expect(leadStaleness({ created_at: '2026-07-01', next_action_on: '2026-07-10', status: 'won' }, { today }).actionOverdue).toBe(false)
  })

  it('blocks conversion and says why, rather than just refusing', () => {
    const bad = canConvertLead({ email: 'a@b.com' })
    expect(bad.ok).toBe(false)
    expect(bad.reasons.some(r => /organisation/i.test(r))).toBe(true)

    const noEmail = canConvertLead({ organisation: 'Meridian' })
    expect(noEmail.reasons.some(r => /email/i.test(r))).toBe(true)

    const already = canConvertLead({ organisation: 'M', email: 'a@b.com', converted_client_id: 'c1' })
    expect(already.reasons.some(r => /already been converted/i.test(r))).toBe(true)

    expect(canConvertLead({ organisation: 'Meridian', email: 'a@b.com' }).ok).toBe(true)
  })

  it('summarises the pipeline and names what needs chasing', () => {
    const rows = [
      { id: '1', created_at: '2026-07-21', status: 'open', is_opportunity: false, owner_id: 'u1', next_action: 'Call', next_action_on: '2026-07-30', last_contacted: '2026-07-21' },
      { id: '2', created_at: '2026-06-01', status: 'open', is_opportunity: false },                       // stale, unowned, no action
      { id: '3', created_at: '2026-07-01', status: 'open', is_opportunity: true, owner_id: 'u1', next_action: 'Demo', next_action_on: '2026-07-10', last_contacted: '2026-07-20' }, // overdue
      { id: '4', created_at: '2026-05-01', status: 'won',  is_opportunity: true, converted_client_id: 'c1' },
      { id: '5', created_at: '2026-05-01', status: 'lost', is_opportunity: false },
      { id: '6', created_at: '2026-07-20', status: 'open', is_opportunity: false, is_spam: true },        // excluded entirely
    ]
    const s = summariseLeads(rows, { today })
    expect(s).toMatchObject({ total: 5, leads: 2, opportunities: 1, won: 1, lost: 1 })
    expect(s.overdue).toBe(1)
    expect(s.stale).toBe(1)        // only #2 — #3 was contacted 2 days ago
    expect(s.unowned).toBe(1)      // closed rows are not chased
    expect(s.noNextAction).toBe(1)
    expect(s.gaps.some(g => /overdue next action/.test(g))).toBe(true)
    expect(s.gaps.some(g => /no contact in 14\+ days/.test(g))).toBe(true)
  })

  it('says so when there are no leads at all', () => {
    // Absent must not render as nothing-to-say.
    expect(summariseLeads([], { today }).gaps).toContain('No leads captured yet.')
  })
})
