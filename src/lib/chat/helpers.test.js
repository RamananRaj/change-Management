import { describe, it, expect } from 'vitest'
import { initialsOf, fmtSize, fileIcon, unreadCount, dmDisplayName } from './helpers'

describe('initialsOf', () => {
  it('takes up to two initials, uppercased', () => {
    expect(initialsOf('Jane Smith')).toBe('JS')
    expect(initialsOf('madonna')).toBe('M')
    expect(initialsOf('')).toBe('?')
    expect(initialsOf('Ada Marie Byron')).toBe('AM')
  })
})

describe('fmtSize', () => {
  it('formats bytes / KB / MB', () => {
    expect(fmtSize(0)).toBe('')
    expect(fmtSize(512)).toBe('512 B')
    expect(fmtSize(2048)).toBe('2 KB')
    expect(fmtSize(5 * 1048576)).toBe('5.0 MB')
  })
})

describe('fileIcon', () => {
  it('maps mime types to icons', () => {
    expect(fileIcon('application/pdf')).toBe('📕')
    expect(fileIcon('application/vnd.openxmlformats-officedocument.wordprocessingml.document')).toBe('📘')
    expect(fileIcon('text/csv')).toBe('📗')
    expect(fileIcon('application/vnd.ms-powerpoint')).toBe('📙')
    expect(fileIcon('application/zip')).toBe('📄')
  })
})

describe('unreadCount', () => {
  const msgs = [
    { sender_id: 'other', created_at: '2026-07-01T10:00:00Z' },
    { sender_id: 'me',    created_at: '2026-07-01T11:00:00Z' },
    { sender_id: 'other', created_at: '2026-07-01T12:00:00Z' },
  ]
  it('counts only others’ messages after last read', () => {
    expect(unreadCount(msgs, '2026-07-01T10:30:00Z', 'me')).toBe(1)   // only the 12:00 one
  })
  it('counts all others’ messages when never read', () => {
    expect(unreadCount(msgs, null, 'me')).toBe(2)
  })
  it('is zero when caught up', () => {
    expect(unreadCount(msgs, '2026-07-01T13:00:00Z', 'me')).toBe(0)
  })
})

describe('dmDisplayName', () => {
  it('uses the group name for groups', () => {
    expect(dmDisplayName({ isGroup: true, groupName: 'RSR team' })).toBe('RSR team')
    expect(dmDisplayName({ isGroup: true, groupName: '' })).toBe('Group')
  })
  it('uses the other participant for DMs', () => {
    expect(dmDisplayName({ isGroup: false, otherName: 'Jane Smith' })).toBe('Jane Smith')
    expect(dmDisplayName({ isGroup: false, otherName: null })).toBe('Direct message')
  })
})
