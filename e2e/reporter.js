// ChangeFlow · custom Playwright reporter — posts each run's summary to the e2e-report Edge
// Function so results appear in System Admin → E2E Tests. No-op when the env isn't set, so
// `npm run e2e` works locally without any backend wiring.
export default class SupabaseReporter {
  constructor() {
    this.specs = []
    this.counts = { total: 0, passed: 0, failed: 0, skipped: 0 }
  }

  onTestEnd(test, result) {
    this.counts.total++
    const status = result.status // 'passed' | 'failed' | 'timedOut' | 'skipped' | 'interrupted'
    if (status === 'passed') this.counts.passed++
    else if (status === 'skipped') this.counts.skipped++
    else this.counts.failed++
    this.specs.push({
      title: test.title,
      file: (test.location?.file || '').split('/').pop(),
      status,
      duration_ms: result.duration,
      error: result.error?.message ? String(result.error.message).replace(/\[[0-9;]*m/g, '').slice(0, 300) : null,
    })
  }

  async onEnd(result) {
    const url = process.env.E2E_REPORT_URL
    const secret = process.env.E2E_REPORT_SECRET
    if (!url || !secret) {
      console.log('[e2e reporter] E2E_REPORT_URL / E2E_REPORT_SECRET not set — skipping platform report')
      return
    }
    const payload = {
      source: process.env.CI ? 'ci' : 'local',
      ...this.counts,
      duration_ms: result.duration,
      specs: this.specs,
      commit: process.env.GITHUB_SHA || '',
      branch: process.env.GITHUB_REF_NAME || '',
    }
    try {
      const r = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-report-secret': secret },
        body: JSON.stringify(payload),
      })
      console.log(`[e2e reporter] posted results → ${r.status}`)
    } catch (e) {
      console.log('[e2e reporter] post failed:', e?.message || e)
    }
  }
}
