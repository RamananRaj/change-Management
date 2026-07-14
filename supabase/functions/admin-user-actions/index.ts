// ChangeFlow — admin-user-actions Edge Function
//
// Performs privileged user-management actions using the service-role key, which stays
// server-side (never in the browser). Every call is authorized against the CALLER's
// identity:
//   • Master Admin (profiles.is_admin)          → may act on any user.
//   • Client Admin (profiles.is_client_admin)   → may act only on non-admin users whose
//                                                  profiles.client_id matches their own.
//
// Actions: "update" (full_name, role, email), "reset" (email a recovery link),
//          "lock"/"unlock" (ban/unban), "delete".
//
// Deploy:  supabase functions deploy admin-user-actions
// (SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY are injected automatically.)

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  try {
    const url        = Deno.env.get('SUPABASE_URL')!
    const anonKey    = Deno.env.get('SUPABASE_ANON_KEY')!
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const authHeader = req.headers.get('Authorization') ?? ''

    // Who is calling? (RLS as the caller)
    const caller = createClient(url, anonKey, { global: { headers: { Authorization: authHeader } } })
    const { data: { user: me } } = await caller.auth.getUser()
    if (!me) return json({ error: 'unauthorized' }, 401)

    const admin = createClient(url, serviceKey)   // service role — full access

    // Check the CALLER's permissions using their own session (respects RLS: an admin can
    // read their own profile). Using service role here can return null if the key isn't
    // effective, which would wrongly 403 an admin.
    const { data: myProfile } = await caller.from('profiles')
      .select('is_admin, is_client_admin, client_id').eq('id', me.id).single()
    if (!myProfile || (!myProfile.is_admin && !myProfile.is_client_admin)) return json({ error: 'forbidden' }, 403)

    const body = await req.json().catch(() => ({}))
    const { action, userId } = body

    // Health check — no target needed, just proves the function is reachable + who called.
    if (action === 'ping') {
      return json({ ok: true, role: myProfile.is_admin ? 'master' : 'client_admin' })
    }

    if (!action || !userId) return json({ error: 'action and userId required' }, 400)

    const { data: target } = await admin.from('profiles')
      .select('id, is_admin, client_id').eq('id', userId).single()
    if (!target) return json({ error: 'target not found' }, 404)

    // Scope: master can touch anyone; client admin only their own client's non-admins.
    const isMaster = !!myProfile.is_admin
    const clientOk = !!myProfile.is_client_admin && !target.is_admin && !!target.client_id && target.client_id === myProfile.client_id
    if (!isMaster && !clientOk) return json({ error: 'forbidden for this user' }, 403)
    // A client admin may never act on an admin, nor grant admin.
    if (!isMaster && target.is_admin) return json({ error: 'forbidden' }, 403)
    if (me.id === userId && (action === 'delete' || action === 'lock')) return json({ error: 'cannot lock or delete yourself' }, 400)

    switch (action) {
      case 'update': {
        const { full_name, role, email } = body
        const patch: Record<string, unknown> = {}
        if (full_name !== undefined) patch.full_name = full_name
        if (role !== undefined)      patch.role = role
        if (Object.keys(patch).length) await admin.from('profiles').update(patch).eq('id', userId)
        if (email) {
          const { error } = await admin.auth.admin.updateUserById(userId, { email })
          if (error) return json({ error: error.message }, 400)
        }
        return json({ ok: true })
      }
      case 'reset': {
        const { email, redirectTo } = body
        if (!email) return json({ error: 'email required' }, 400)
        const { error } = await caller.auth.resetPasswordForEmail(email, redirectTo ? { redirectTo } : undefined)
        if (error) return json({ error: error.message }, 400)
        return json({ ok: true })
      }
      case 'lock':
      case 'unlock': {
        const ban_duration = action === 'lock' ? '876000h' : 'none'   // ~100y / clear
        const { error } = await admin.auth.admin.updateUserById(userId, { ban_duration })
        if (error) return json({ error: error.message }, 400)
        return json({ ok: true })
      }
      case 'delete': {
        const { error } = await admin.auth.admin.deleteUser(userId)
        if (error) return json({ error: error.message }, 400)
        await admin.from('profiles').delete().eq('id', userId)   // in case no FK cascade
        return json({ ok: true })
      }
      default:
        return json({ error: 'unknown action' }, 400)
    }
  } catch (e) {
    return json({ error: String(e) }, 500)
  }
})
