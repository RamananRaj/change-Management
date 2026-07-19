// ChangeFlow — notify-chat Edge Function
//
// Called on a schedule (pg_cron → x-cron-secret). Finds each user's unread, qualifying chat
// messages and delivers via the channels the admin enabled: email (Resend) and/or web push (VAPID).
// Per-user throttling honours the admin's cadence (immediate vs digest). Missing provider keys are
// skipped gracefully, so the function is safe to run before email/push are fully configured.
//
// Deploy:  supabase functions deploy notify-chat --no-verify-jwt
// Secrets: NOTIFY_CRON_SECRET, RESEND_API_KEY, NOTIFY_FROM, NOTIFY_APP_URL,
//          VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT (mailto:you@domain)

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
// Web Push (VAPID) is wired in Stage 2 — the sender lib is added then so email can ship first.

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } })

// ── pure decision logic (mirrors src/lib/chat/notify.js) ──
function qualifyingMessages(messages: any[], since: Date, trigger: string, userId: string) {
  if (trigger === 'off') return []
  return messages.filter(m => {
    if (m.sender_id === userId) return false
    if (new Date(m.created_at).getTime() <= since.getTime()) return false
    if (trigger === 'all') return true
    return !!(m.isDirect || m.isMention)
  })
}
function shouldNotifyNow(lastNotifiedAt: string | null, cadence: string, digestMinutes: number, hasMessages: boolean) {
  if (!hasMessages) return false
  if (cadence === 'immediate') return true
  if (!lastNotifiedAt) return true
  return (Date.now() - new Date(lastNotifiedAt).getTime()) / 60000 >= digestMinutes
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  try {
    const url = Deno.env.get('SUPABASE_URL')!
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || Deno.env.get('SB_SERVICE_ROLE_KEY') || ''
    const cronSecret = Deno.env.get('NOTIFY_CRON_SECRET') ?? ''
    if (!cronSecret || req.headers.get('x-cron-secret') !== cronSecret) return json({ error: 'unauthorized' }, 401)
    const admin = createClient(url, serviceKey)

    const { data: cfgRow } = await admin.from('notification_config').select('*').eq('id', true).single()
    const cfg = cfgRow ?? { trigger: 'mentions', cadence: 'digest', digest_minutes: 15, email_enabled: true, push_enabled: true }
    if (cfg.trigger === 'off') return json({ ok: true, skipped: 'trigger off' })

    // Load the recent picture (last 24h keeps the scan bounded).
    const dayAgo = new Date(Date.now() - 864e5).toISOString()
    const [{ data: channels }, { data: members }, { data: messages }, { data: profiles }, { data: states }] = await Promise.all([
      admin.from('chat_channels').select('id, type'),
      admin.from('chat_members').select('channel_id, user_id, last_read_at'),
      admin.from('chat_messages').select('channel_id, sender_id, body, created_at').gte('created_at', dayAgo).order('created_at', { ascending: false }),
      admin.from('profiles').select('id, full_name'),
      admin.from('notification_state').select('user_id, last_notified_at'),
    ])
    const chanType = (id: string) => (channels ?? []).find((c: any) => c.id === id)?.type
    const nameOf = (id: string) => (profiles ?? []).find((p: any) => p.id === id)?.full_name ?? 'Someone'
    const lastNotified = (id: string) => (states ?? []).find((s: any) => s.user_id === id)?.last_notified_at ?? null

    // Set up delivery clients (each optional).
    const resendKey = Deno.env.get('RESEND_API_KEY'); const from = Deno.env.get('NOTIFY_FROM'); const appUrl = Deno.env.get('NOTIFY_APP_URL') ?? ''
    // Web Push is delivered in Stage 2 (VAPID sender added then). Subscriptions are still collected
    // now so they're ready when push is switched on.
    const appServer: any = null
    const { data: subs } = cfg.push_enabled ? await admin.from('push_subscriptions').select('user_id, endpoint, p256dh, auth') : { data: [] }

    const memberUsers = [...new Set((members ?? []).map((m: any) => m.user_id))]
    let notified = 0, emails = 0, pushes = 0

    for (const uid of memberUsers) {
      const myChannels = (members ?? []).filter((m: any) => m.user_id === uid)
      const readMap: Record<string, number> = {}
      myChannels.forEach((m: any) => { readMap[m.channel_id] = m.last_read_at ? new Date(m.last_read_at).getTime() : 0 })
      const since = new Date(lastNotified(uid) ?? dayAgo)

      // Unread (per-channel vs last_read_at) messages in my channels, enriched.
      const candidates = (messages ?? [])
        .filter((m: any) => readMap[m.channel_id] !== undefined)
        .filter((m: any) => new Date(m.created_at).getTime() > (readMap[m.channel_id] ?? 0))
        .map((m: any) => ({ ...m, isDirect: chanType(m.channel_id) === 'dm', senderName: nameOf(m.sender_id) }))

      const q = qualifyingMessages(candidates, since, cfg.trigger, uid)
      if (!shouldNotifyNow(lastNotified(uid), cfg.cadence, cfg.digest_minutes, q.length > 0)) continue

      const senders = [...new Set(q.map((m: any) => m.senderName))]
      const who = senders.length === 1 ? senders[0] : `${senders[0]} and ${senders.length - 1} other${senders.length === 2 ? '' : 's'}`
      const title = `${q.length} new message${q.length === 1 ? '' : 's'} from ${who}`

      // Email
      if (cfg.email_enabled && resendKey && from) {
        try {
          const { data: u } = await admin.auth.admin.getUserById(uid)
          const email = u?.user?.email
          if (email) {
            const lines = q.slice(0, 8).map((m: any) => `<li><strong>${m.senderName}:</strong> ${String(m.body ?? '').slice(0, 140)}</li>`).join('')
            const html = `<p>${title} in ChangeFlow (CFM).</p><ul>${lines}</ul><p><a href="${appUrl}">Open ChangeFlow →</a></p>`
            const r = await fetch('https://api.resend.com/emails', {
              method: 'POST', headers: { Authorization: `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
              body: JSON.stringify({ from, to: email, subject: title, html }),
            })
            if (r.ok) emails++
          }
        } catch (_) { /* email best-effort */ }
      }

      // Web push
      if (appServer) {
        const mySubs = (subs ?? []).filter((s: any) => s.user_id === uid)
        for (const s of mySubs) {
          try {
            const subscriber = appServer.subscribe({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } })
            await subscriber.pushTextMessage(JSON.stringify({ title: 'ChangeFlow · CFM', body: title, url: appUrl }), {})
            pushes++
          } catch (_) { /* stale subscription — ignore */ }
        }
      }

      await admin.from('notification_state').upsert({ user_id: uid, last_notified_at: new Date().toISOString() })
      notified++
    }

    return json({ ok: true, notified, emails, pushes })
  } catch (e) {
    return json({ error: String(e) }, 500)
  }
})
