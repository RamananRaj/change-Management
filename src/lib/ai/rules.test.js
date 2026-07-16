import { describe, it, expect } from 'vitest'
import { matchIntent } from './intents'

// Pure intent-matching tests — no Supabase, no network. Guards the router's first tier:
// these phrasings must resolve to the right grounded intent (and stay out of the model).

describe('matchIntent', () => {
  const cases = [
    ["Who's behind on Phase 2?",                     'members_behind'],
    ['who is behind',                                'members_behind'],
    ["What's at risk this week?",                    'at_risk'],
    ['show me overdue items',                        'at_risk'],
    ['any blockers?',                                'at_risk'],
    ['what milestones are due next week',            'milestones'],
    ['what is due soon',                             'milestones'],
    ['progress by project',                          'progress'],
    ['how far along are we',                         'progress'],
    ['summarise readiness',                          'readiness'],
    ['what is the RAG status',                       'readiness'],
  ]
  it.each(cases)('%s → %s', (text, intent) => {
    expect(matchIntent(text)?.intent).toBe(intent)
  })

  it('captures a phase number param', () => {
    expect(matchIntent("who's behind on phase 3")).toEqual({ intent: 'members_behind', params: { phase: 3 } })
  })

  it('returns null for open-ended text (escalates past rules)', () => {
    expect(matchIntent('write me a poem about change fatigue')).toBeNull()
    expect(matchIntent('')).toBeNull()
    expect(matchIntent(null)).toBeNull()
  })
})
