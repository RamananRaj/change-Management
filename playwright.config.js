import { defineConfig, devices } from '@playwright/test'

// E2E against the deployed app (override with E2E_BASE_URL). The custom reporter posts a summary
// to the e2e-report Edge Function when E2E_REPORT_URL + E2E_REPORT_SECRET are set (CI); otherwise
// it's a no-op, so `npm run e2e` works locally without any backend wiring.
export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list'], ['./e2e/reporter.js']],
  use: {
    baseURL: process.env.E2E_BASE_URL || 'https://change-management-rust.vercel.app',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
})
