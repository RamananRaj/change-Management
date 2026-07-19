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

const FOLLOWUP_RE = /^(why|how|what about|and\b|so\b|then\b|explain|tell me more|more\b|expand|elaborate|details?|what else|go on|continue|the next|next\b)/i

// Build CORA's conversational context for a chat channel — the same memory the dashboard canvas
// keeps, so an @cora answer in the thread auto-scopes to whatever the channel is discussing.
//   entity : the client/project/person most recently named (in the question, else in the thread),
//            so terse follow-ups ("give me more detail") narrow to the right client/project.
//   q      : the question, with the remembered entity appended when the follow-up names nothing.
//   history: recent CORA Q&A turns in this channel, for continuity in the conversational tiers.
// entityNames should be longest-first so multi-word names win over their substrings.
export function chatCoraContext(messages, question, entityNames = []) {
  const arr = messages || []
  const lower = (question || '').toLowerCase()
  const nameIn = text => entityNames.find(n => n && n.length >= 3 && text.includes(n.toLowerCase())) || null
  const named = nameIn(lower)
  let entity = named
  if (!entity) {
    for (let i = arr.length - 1; i >= 0; i--) {   // most-recent mention wins
      const hit = nameIn(String(arr[i].body || '').toLowerCase())
      if (hit) { entity = hit; break }
    }
  }
  const isFollowup = FOLLOWUP_RE.test(question || '') || (question || '').trim().split(/\s+/).length <= 4
  let q = question || ''
  if (!named && entity && isFollowup) q = `${q} (regarding ${entity})`

  const history = []
  for (let i = 0; i < arr.length; i++) {
    if (!arr[i].is_ai) continue
    let qy = ''
    for (let j = i - 1; j >= 0; j--) { if (!arr[j].is_ai) { qy = String(arr[j].body || '').replace(/@cora/ig, '').trim(); break } }
    history.push({ q: qy, a: String(arr[i].body || '').replace(/\*\*/g, '').slice(0, 400) })
  }
  return { q, entity, history: history.slice(-6) }
}
