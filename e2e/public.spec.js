import { test, expect } from '@playwright/test'

// Public, no-login smoke tests — always run. Verify the auth surfaces render and that protected
// routes bounce anonymous users to sign-in.
test.describe('public pages', () => {
  test('sign-in page renders its form', async ({ page }) => {
    await page.goto('/auth/signin')
    await expect(page.getByPlaceholder('you@example.com')).toBeVisible()
    await expect(page.getByPlaceholder('Your password')).toBeVisible()
    await expect(page.getByRole('button', { name: /sign in/i })).toBeVisible()
  })

  test('sign-up page renders its form', async ({ page }) => {
    await page.goto('/auth/signup')
    await expect(page.getByPlaceholder('you@example.com')).toBeVisible()
    await expect(page.getByPlaceholder('At least 6 characters')).toBeVisible()
  })

  test('reset page renders the email field', async ({ page }) => {
    await page.goto('/auth/reset')
    await expect(page.getByPlaceholder('you@example.com')).toBeVisible()
  })

  test('protected /admin redirects anonymous users to sign-in', async ({ page }) => {
    await page.goto('/admin')
    await expect(page).toHaveURL(/\/auth\/signin/, { timeout: 15_000 })
    await expect(page.getByPlaceholder('you@example.com')).toBeVisible()
  })
})
