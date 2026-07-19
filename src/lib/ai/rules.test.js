import { describe, it, expect } from 'vitest'
import { matchIntent } from './rules'

describe('matchIntent', () => {
  const cases = [
    ["Who's behind on Phase 2?",                     'members_behind'],
    ['who is behind',                                'members_behind'],
    ["What's at risk this week?",                    'at_risk'],
    ['show me overdue items',                        'at_risk'],
    ['any blockers?',                                'at_risk'],
    ['what milestones are due next week',            'milestones'],
    ['what is due soon',                             'milestones'],
    ['Show all clients',                             'clients'],
    ['which clients do we have',                     'clients'],
    ['progress by project',                          'progress'],
    ['how far along are we',                         'progress'],
    ['summarise readiness',                          'readiness'],
    ['what is the RAG status',                       'readiness'],
    // ── AI Canvas capabilities ──
    ['show me the heat map',                         'heatmap'],
    ['heat map for Horizon Power',                   'heatmap'],
    ['stakeholder map',                              'heatmap'],
    ['build the change report for Horizon Power',    'report'],
    ['generate a report',                            'report'],
    ['my progress',                                  'my_progress'],
    ['how am I doing',                               'my_progress'],
    ['my readiness',                                 'my_readiness'],
    ['my surveys',                                   'my_readiness'],
    ['show all people',                              'people'],
    ['the team members',                             'people'],
    ['upcoming milestones',                          'upcoming'],
    ['coming up next',                               'upcoming'],
  ]
  it.each(cases)('%s → %s', (text, intent) => {
    expect(matchIntent(text)?.intent).toBe(intent)
  })

  it('captures a phase number param', () => {
    expect(matchIntent("who's behind on phase 3")).toEqual({ intent: 'members_behind', params: { phase: 3 } })
  })

  // Precedence: specific "my ..." and report/heatmap must beat the generic intents.
  it('routes personal + specific intents ahead of generic ones', () => {
    expect(matchIntent('my progress').intent).toBe('my_progress')       // not 'progress'
    expect(matchIntent('my readiness').intent).toBe('my_readiness')     // not 'readiness'
    expect(matchIntent('change report for X').intent).toBe('report')    // not 'heatmap'
    expect(matchIntent('upcoming milestones').intent).toBe('upcoming')  // not 'milestones'
  })

  it('returns null for open-ended text (escalates past rules)', () => {
    expect(matchIntent('write me a poem about change fatigue')).toBeNull()
    expect(matchIntent('')).toBeNull()
    expect(matchIntent(null)).toBeNull()
  })
})
