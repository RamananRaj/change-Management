import { describe, it, expect, beforeAll } from 'vitest'
import { createClient } from '@supabase/supabase-js'

// Integration tests against the REAL Supabase project. Skipped unless credentials are provided,
// so `npm test` stays green offline. Run with:
//   TEST_SUPABASE_URL=... TEST_SUPABASE_ANON_KEY=... \
//   TEST_ADMIN_EMAIL=... TEST_ADMIN_PASSWORD=... npm test -- src/integration
// Optional extras:
//   RUN_RESET_TEST=1 TEST_RESET_EMAIL=<dedicated inbox>     # sends a real recovery email
//   TEST_DM_USER_ID=<uuid in the admin's client>            # exercises a chat round-trip

const {
  TEST_SUPABASE_URL, TEST_SUPABASE_ANON_KEY,
  TEST_ADMIN_EMAIL, TEST_ADMIN_PASSWORD,
  RUN_RESET_TEST, TEST_RESET_EMAIL, TEST_DM_USER_ID,
} = process.env
const configured = !!(TEST_SUPABASE_URL && TEST_SUPABASE_ANON_KEY && TEST_ADMIN_EMAIL && TEST_ADMIN_PASSWORD)

describe.skipIf(!configured)('platform integration', () => {
  let supabase
  beforeAll(async () => {
    supabase = createClient(TEST_SUPABASE_URL, TEST_SUPABASE_ANON_KEY)
    const { error } = await supabase.auth.signInWithPassword({ email: TEST_ADMIN_EMAIL, password: TEST_ADMIN_PASSWORD })
    if (error) throw error
  })

  // ── Auto-unlock (real SQL function via RPC) ──
  it('auto_unlock_phases() runs and returns a count', async () => {
    const { data, error } = await supabase.rpc('auto_unlock_phases')
    expect(error).toBeFalsy()
    expect(typeof data).toBe('number')          // number of phases unlocked (0+)
  })

  // ── Chat round-trip (create DM → send → read) ──
  it.skipIf(!TEST_DM_USER_ID)('chat: create a DM, send and read a message', async () => {
    const { data: { user } } = await supabase.auth.getUser()
    const { data: chan, error: cErr } = await supabase.from('chat_channels')
      .insert({ type: 'dm', created_by: user.id }).select().single()
    expect(cErr).toBeFalsy()
    await supabase.from('chat_members').insert([
      { channel_id: chan.id, user_id: user.id },
      { channel_id: chan.id, user_id: TEST_DM_USER_ID },
    ])
    const body = `test ${Date.now()}`
    const { error: mErr } = await supabase.from('chat_messages').insert({ channel_id: chan.id, sender_id: user.id, body })
    expect(mErr).toBeFalsy()
    const { data: msgs } = await supabase.from('chat_messages').select('body').eq('channel_id', chan.id)
    expect(msgs.map(m => m.body)).toContain(body)
    await supabase.from('chat_channels').delete().eq('id', chan.id)   // cleanup
  })

  // ── Password reset request (sends a real email — opt-in) ──
  it.skipIf(!(RUN_RESET_TEST && TEST_RESET_EMAIL))('reset: requests a recovery link', async () => {
    const { error } = await supabase.auth.resetPasswordForEmail(TEST_RESET_EMAIL, {
      redirectTo: `${TEST_SUPABASE_URL}/auth/reset`,
    })
    expect(error).toBeFalsy()
  })
})
