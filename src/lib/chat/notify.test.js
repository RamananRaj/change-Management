import { describe, it, expect } from 'vitest'
import { qualifyingMessages, shouldNotifyNow, notificationSummary } from './notify'

const since = new Date('2026-07-19T10:00:00Z')
const msgs = [
  { sender_id: 'other', created_at: '2026-07-19T10:05:00Z', body: 'hi', isDirect: true,  senderName: 'Jane' },
  { sender_id: 'me',    created_at: '2026-07-19T10:06:00Z', body: 'yo', isDirect: true,  senderName: 'Me' },
  { sender_id: 'other', created_at: '2026-07-19T10:07:00Z', body: 'group ping', isDirect: false, senderName: 'Jane' },
  { sender_id: 'other', created_at: '2026-07-19T09:59:00Z', body: 'old', isDirect: true,  senderName: 'Jane' },
]

describe('qualifyingMessages', () => {
  it('off → nothing', () => {
    expect(qualifyingMessages(msgs, { since, trigger: 'off', userId: 'me' })).toEqual([])
  })
  it('all → every not-mine message after since', () => {
    const r = qualifyingMessages(msgs, { since, trigger: 'all', userId: 'me' })
    expect(r.map(m => m.body)).toEqual(['hi', 'group ping'])   // excludes mine + the old one
  })
  it('mentions → only DMs / explicit mentions', () => {
    const r = qualifyingMessages(msgs, { since, trigger: 'mentions', userId: 'me' })
    expect(r.map(m => m.body)).toEqual(['hi'])                 // the group ping is excluded
  })
  it('honours isMention flag in mentions mode', () => {
    const m = [{ sender_id: 'o', created_at: '2026-07-19T10:05:00Z', body: '@me look', isDirect: false, isMention: true }]
    expect(qualifyingMessages(m, { since, trigger: 'mentions', userId: 'me' })).toHaveLength(1)
  })
})

describe('shouldNotifyNow', () => {
  it('never fires with no messages', () => {
    expect(shouldNotifyNow({ hasMessages: false, cadence: 'immediate' })).toBe(false)
  })
  it('immediate fires whenever there is something', () => {
    expect(shouldNotifyNow({ hasMessages: true, cadence: 'immediate' })).toBe(true)
  })
  it('digest waits for the interval', () => {
    const now = new Date('2026-07-19T10:20:00Z')
    expect(shouldNotifyNow({ hasMessages: true, cadence: 'digest', digestMinutes: 15, lastNotifiedAt: '2026-07-19T10:10:00Z', now })).toBe(false) // 10 min
    expect(shouldNotifyNow({ hasMessages: true, cadence: 'digest', digestMinutes: 15, lastNotifiedAt: '2026-07-19T10:00:00Z', now })).toBe(true)  // 20 min
  })
  it('digest fires first time (no prior)', () => {
    expect(shouldNotifyNow({ hasMessages: true, cadence: 'digest', digestMinutes: 15, lastNotifiedAt: null })).toBe(true)
  })
})

describe('notificationSummary', () => {
  it('summarises count and senders', () => {
    expect(notificationSummary([{ senderName: 'Jane' }])).toBe('1 new message from Jane')
    expect(notificationSummary([{ senderName: 'Jane' }, { senderName: 'Ravi' }])).toBe('2 new messages from Jane and Ravi')
    expect(notificationSummary([{ senderName: 'Jane' }, { senderName: 'Ravi' }, { senderName: 'Sam' }])).toBe('3 new messages from Jane and 2 others')
    expect(notificationSummary([])).toBe('No new messages')
  })
})
