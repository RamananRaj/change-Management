import { describe, it, expect, beforeAll } from 'vitest'
import { createClient } from '@supabase/supabase-js'

// Integration tests that hit the REAL deployed Supabase project + Edge Functions.
// Skipped unless credentials are provided, so `npm test` stays green without a network.
//
// Run with:
//   TEST_SUPABASE_URL=... \
//   TEST_SUPABASE_ANON_KEY=<publishable key> \
//   TEST_ADMIN_EMAIL=... TEST_ADMIN_PASSWORD=... \
//   npm test -- src/integration
//
// To also exercise the password-reset path (sends a real recovery email to a TEST
// account — use a dedicated address), add:
//   RUN_RESET_TEST=1 TEST_RESET_USER_ID=<uuid> TEST_RESET_EMAIL=<test@inbox>

const {
  TEST_SUPABASE_URL, TEST_SUPABASE_ANON_KEY,
  TEST_ADMIN_EMAIL, TEST_ADMIN_PASSWORD,
  RUN_RESET_TEST, TEST_RESET_USER_ID, TEST_RESET_EMAIL,
} = process.env

const configured = !!(TEST_SUPABASE_URL && TEST_SUPABASE_ANON_KEY && TEST_ADMIN_EMAIL && TEST_ADMIN_PASSWORD)

describe.skipIf(!configured)('admin-user-actions (integration)', () => {
  let supabase

  beforeAll(async () => {
    supabase = createClient(TEST_SUPABASE_URL, TEST_SUPABASE_ANON_KEY)
    const { error } = await supabase.auth.signInWithPassword({ email: TEST_ADMIN_EMAIL, password: TEST_ADMIN_PASSWORD })
    if (error) throw error
  })

  it('ping: function reachable and authorizes an admin', async () => {
    const { data, error } = await supabase.functions.invoke('admin-user-actions', { body: { action: 'ping' } })
    expect(error).toBeFalsy()
    expect(data?.ok).toBe(true)
    expect(['master', 'client_admin']).toContain(data?.role)
  })

  it('rejects an unknown action', async () => {
    const { data, error } = await supabase.functions.invoke('admin-user-actions', { body: { action: 'nope', userId: '00000000-0000-0000-0000-000000000000' } })
    // supabase-js reports non-2xx via `error`; either way it must not succeed.
    expect(error || data?.error).toBeTruthy()
  })

  it.skipIf(!(RUN_RESET_TEST && TEST_RESET_USER_ID && TEST_RESET_EMAIL))(
    'reset: sends a recovery link for a test user', async () => {
      const { data, error } = await supabase.functions.invoke('admin-user-actions', {
        body: { action: 'reset', userId: TEST_RESET_USER_ID, email: TEST_RESET_EMAIL, redirectTo: `${TEST_SUPABASE_URL}/auth/reset` },
      })
      expect(error).toBeFalsy()
      expect(data?.ok).toBe(true)
    },
  )
})
