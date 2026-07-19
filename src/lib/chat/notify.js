// ChangeFlow · chat-notification decision logic (pure, no Supabase) — unit-testable.
// The notify-chat Edge Function does the DB reads and delivery; this module decides *what* to send.

// Messages worth notifying a recipient about, given the admin's trigger scope.
//   trigger 'off'      → nothing
//   trigger 'mentions' → direct messages (DMs) or explicit @-mentions of the recipient
//   trigger 'all'      → every message in their channels
// Each message: { sender_id, created_at, body, isDirect?, isMention? }. `since` is a Date (last
// notified / last read); `userId` is the recipient (their own messages never notify them).
export function qualifyingMessages(messages, { since, trigger, userId } = {}) {
  if (trigger === 'off' || !trigger) return []
  const sinceMs = since ? new Date(since).getTime() : 0
  return (messages || []).filter(m => {
    if (m.sender_id === userId) return false
    if (new Date(m.created_at).getTime() <= sinceMs) return false
    if (trigger === 'all') return true
    return !!(m.isDirect || m.isMention)   // 'mentions'
  })
}

// Given the cadence, is it time to notify this user now? Immediate = as soon as there's anything;
// digest = only once digest_minutes have elapsed since we last notified them.
export function shouldNotifyNow({ lastNotifiedAt, now = new Date(), cadence, digestMinutes = 15, hasMessages }) {
  if (!hasMessages) return false
  if (cadence === 'immediate') return true
  if (!lastNotifiedAt) return true
  const elapsedMin = (new Date(now).getTime() - new Date(lastNotifiedAt).getTime()) / 60000
  return elapsedMin >= digestMinutes
}

// One-line summary for the email subject / push title.
export function notificationSummary(messages) {
  const n = (messages || []).length
  if (n === 0) return 'No new messages'
  const senders = [...new Set(messages.map(m => m.senderName).filter(Boolean))]
  const who = senders.length === 1 ? senders[0] : senders.length === 2 ? `${senders[0]} and ${senders[1]}` : `${senders[0]} and ${senders.length - 1} others`
  return `${n} new message${n === 1 ? '' : 's'}${who ? ` from ${who}` : ''}`
}
