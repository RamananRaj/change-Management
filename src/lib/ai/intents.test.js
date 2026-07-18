import { describe, it, expect } from 'vitest'
import { matchIntent } from './intents'

describe('matchIntent', () => {
  it('maps report synonyms to the report intent', () => {
    for (const q of [
      'build me a change report',
      'give me the exec pack for Horizon Power',
      'monthly wrap-up for RSR',
      'status update please',
      'board pack',
      'full picture for the programme',
    ]) {
      expect(matchIntent(q)?.intent, q).toBe('report')
    }
  })

  it('recognises the core intents', () => {
    expect(matchIntent('what is at risk this week')?.intent).toBe('at_risk')
    expect(matchIntent('show me the heat map')?.intent).toBe('heatmap')
    expect(matchIntent('progress by project')?.intent).toBe('progress')
    expect(matchIntent('who is behind on their steps')?.intent).toBe('members_behind')
    expect(matchIntent('what is due this week')?.intent).toBe('milestones')
    expect(matchIntent('what is coming up')?.intent).toBe('upcoming')
  })

  it('captures a phase number into params', () => {
    const m = matchIntent('summarise phase 3')
    expect(m?.intent).toBe('readiness')
    expect(m?.params.phase).toBe(3)
  })

  it('prefers personal intents over generic ones', () => {
    expect(matchIntent('how am i doing')?.intent).toBe('my_progress')
    expect(matchIntent('my readiness')?.intent).toBe('my_readiness')
  })

  it('returns null for empty or unmatched text', () => {
    expect(matchIntent('')).toBeNull()
    expect(matchIntent('   ')).toBeNull()
    expect(matchIntent('qwerty zxcv nonsense token')).toBeNull()
  })
})
