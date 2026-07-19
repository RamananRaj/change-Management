// ChangeFlow · CFM pure helpers (no Supabase) — unit-testable. Used by useChat + CFM.

export const initialsOf = n => (n || '?').split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2)

export const fmtSize = b => !b ? '' : b < 1024 ? `${b} B` : b < 1048576 ? `${(b / 1024).toFixed(0)} KB` : `${(b / 1048576).toFixed(1)} MB`

export const fileIcon = t => (t || '').includes('pdf') ? '📕'
  : /word|document/.test(t || '') ? '📘'
  : /sheet|excel|csv/.test(t || '') ? '📗'
  : /presentation|powerpoint/.test(t || '') ? '📙'
  : '📄'

// Messages newer than my last-read that I didn't send. lastReadAt null = everything is unread.
export function unreadCount(messages, lastReadAt, myId) {
  const lr = lastReadAt ? new Date(lastReadAt) : new Date(0)
  return (messages || []).filter(m => m.sender_id !== myId && new Date(m.created_at) > lr).length
}

// Display name: a group uses its name; a DM shows the other participant's name.
export function dmDisplayName({ isGroup, groupName, otherName }) {
  return isGroup ? (groupName || 'Group') : (otherName || 'Direct message')
}
