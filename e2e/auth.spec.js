import { test, expect } from '@playwright/test'

// Authenticated flows — run only when a test account is provided (E2E_EMAIL / E2E_PASSWORD),
// mirroring the skip-guarded integration tests. Set them as CI secrets to activate.
const EMAIL = process.env.E2E_EMAIL
const PASSWORD = process.env.E2E_PASSWORD

test.describe('authenticated', () => {
  test.skip(!EMAIL || !PASSWORD, 'Set E2E_EMAIL + E2E_PASSWORD to run authenticated E2E tests')

  test.beforeEach(async ({ page }) => {
    await page.goto('/auth/signin')
    await page.getByPlaceholder('you@example.com').fill(EMAIL)
    await page.getByPlaceholder('Your password').fill(PASSWORD)
    await page.getByRole('button', { name: /sign in/i }).click()
    await expect(page).not.toHaveURL(/\/auth\/signin/, { timeout: 20_000 })
  })

  test('signs in and reaches an app view', async ({ page }) => {
    // After login the app routes to a role dashboard / onboarding — just assert we left auth.
    await expect(page).toHaveURL(/\/(dashboard|admin|canvas|onboarding|client-admin)/, { timeout: 20_000 })
  })

  test('System Admin shows its sub-navigation', async ({ page }) => {
    await page.goto('/admin')
    // Master Admins see the System Admin hub with its tabs.
    await expect(page.getByText('User Management')).toBeVisible({ timeout: 20_000 })
  })
})
