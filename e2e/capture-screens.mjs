// ChangeFlow · screenshot capture for docs and the sales deck.
//
// The app signs in with Apple/OAuth, so there is no password to script. Instead we use
// Playwright's saved-session pattern: log in ONCE by hand in a visible browser, save the
// authenticated session to a file, and every capture run after that reuses it.
//
// ── ONE-TIME LOGIN ───────────────────────────────────────────────────────────
//   npm run e2e:install          # once, downloads the browser
//   npm run shots:login          # opens a visible browser — sign in with Apple yourself.
//                                #   When you land in the app, the session is saved and
//                                #   the browser closes. Nothing is typed for you.
//
// ── CAPTURE (repeat anytime) ─────────────────────────────────────────────────
//   npm run shots                # loads the saved session, walks the screens, writes PNGs
//
// The saved session (e2e/.auth/state.json) holds a login token — it is gitignored and
// must never be committed. Delete it to force a fresh login. It expires; if capture
// starts landing on the sign-in page, run `npm run shots:login` again.

import { chromium } from '@playwright/test'
import { mkdirSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const HERE  = dirname(fileURLToPath(import.meta.url))
const BASE  = process.env.E2E_BASE_URL || 'https://change-management-rust.vercel.app'
const OUT   = join(HERE, '..', 'screenshots')
const AUTH  = join(HERE, '.auth')
const STATE = join(AUTH, 'state.json')
const LOGIN = process.argv.includes('--login')
const VIEWPORT = { width: 1440, height: 900 }

mkdirSync(AUTH, { recursive: true })

// ─────────────────────────────────────────────────────────────────────────────
// LOGIN MODE — open a visible browser, let the human sign in, save the session.
// ─────────────────────────────────────────────────────────────────────────────
if (LOGIN) {
  console.log('Opening a browser. Sign in with Apple as you normally would.')
  console.log('When you reach the app (past the sign-in page), the session saves automatically.\n')
  const browser = await chromium.launch({ headless: false })
  const context = await browser.newContext({ viewport: VIEWPORT })
  const page = await context.newPage()
  await page.goto(`${BASE}/auth/signin`)

  try {
    // Wait — up to 5 minutes — for the human to finish login and leave the sign-in page.
    await page.waitForURL(u => !/\/auth\/signin/.test(u.toString()), { timeout: 300000 })
    await page.waitForTimeout(2500)   // let the app settle and write its session to storage
    await context.storageState({ path: STATE })
    console.log(`\n✓ Session saved to ${STATE}`)
    console.log('  Run `npm run shots` to capture. Keep this file private — it is a login token.')
  } catch {
    console.error('\n✗ Timed out waiting for sign-in. Nothing saved. Re-run and complete the login.')
  } finally {
    await browser.close()
  }
  process.exit(0)
}

// ─────────────────────────────────────────────────────────────────────────────
// CAPTURE MODE — reuse the saved session, walk the screens.
// ─────────────────────────────────────────────────────────────────────────────
if (!existsSync(STATE)) {
  console.error('✗ No saved session. Run `npm run shots:login` first and sign in with Apple.')
  process.exit(1)
}

mkdirSync(OUT, { recursive: true })
const done = [], missed = []

async function shot(page, name, note) {
  try {
    await page.waitForTimeout(1200)
    await page.screenshot({ path: join(OUT, `${name}.png`) })
    done.push(name); console.log(`  ✓ ${name}.png — ${note}`)
  } catch (e) { missed.push(name); console.warn(`  ✗ ${name} — ${e.message.split('\n')[0]}`) }
}
async function clickText(page, text) {
  try { await page.getByText(text, { exact: false }).first().click({ timeout: 6000 }); return true }
  catch { return false }
}

const browser = await chromium.launch()
// storageState restores the OAuth session captured during --login, so no sign-in is needed.
const context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 2, storageState: STATE })
const page = await context.newPage()

try {
  // If the session has expired we'll be bounced to /auth/signin — detect and say so.
  await page.goto(`${BASE}/canvas`)
  await page.waitForTimeout(2000)
  if (/\/auth\/signin/.test(page.url())) {
    console.error('✗ The saved session has expired. Run `npm run shots:login` again.')
    await browser.close(); process.exit(1)
  }

  console.log('CORA canvas:')
  try {
    const box = page.getByPlaceholder(/ask cora/i).first()
    await box.click({ timeout: 6000 })          // the pill expands into an input
    await box.fill('Brief me on Meridian')
    await box.press('Enter')
    // Wait for the answer to render: the empty-state helper text disappears once CORA
    // replies. Falling back to a fixed wait if that text isn't found, so we still capture.
    await page.getByText(/tap a chip above|suggestion below/i)
      .waitFor({ state: 'hidden', timeout: 20000 }).catch(() => {})
    await page.waitForTimeout(4000)             // let widgets/charts in the answer settle
  } catch { /* capture whatever rendered */ }
  await shot(page, '01-cora-canvas', 'CORA answering a question')

  console.log('Admin:')
  await page.goto(`${BASE}/admin`); await page.waitForTimeout(1500)
  await shot(page, '02-admin', 'System Admin / Clients landing')

  const CLIENT = process.env.SHOT_CLIENT || 'Meridian'
  console.log(`Client tabs (${CLIENT}):`)
  await clickText(page, 'Clients'); await page.waitForTimeout(800)
  if (await clickText(page, CLIENT)) {
    await page.waitForTimeout(1000)
    if (await clickText(page, 'Delivery')) { await page.waitForTimeout(500)
      if (await clickText(page, 'Timeline')) await shot(page, '03-timeline', 'timeline with swimlanes') }
    if (await clickText(page, 'Comms')) await shot(page, '04-comms', 'comms plan — blocked vs overdue')
    if (await clickText(page, 'People')) { await page.waitForTimeout(500)
      if (await clickText(page, 'Audiences')) await shot(page, '05-audiences', 'audience register + impact') }
    if (await clickText(page, 'Projects')) { await page.waitForTimeout(500)
      await shot(page, '06-projects', 'projects with scope picker') }
  } else {
    console.warn(`  ✗ could not find client "${CLIENT}" — set SHOT_CLIENT to an existing name.`)
  }
} finally {
  await browser.close()
  console.log(`\nCaptured ${done.length} to ${OUT}`)
  if (missed.length) console.log(`Missed (grab these manually): ${missed.join(', ')}`)
}
