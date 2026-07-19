// ChangeFlow — report-generate Edge Function
//
// Builds a TRUE native Word (.docx) change report server-side, stores it in the private `reports`
// bucket and records it in report_files. No browser required, so it runs reliably on a schedule.
//
// Callers:
//   • pg_cron (hourly, x-cron-secret) → generates every schedule that is due now
//   • Master Admin (JWT)              → { scheduleId } or { clientId, projectId? } for one-off
//
// Deploy:  supabase functions deploy report-generate --no-verify-jwt
// Secret:  REPORT_CRON_SECRET

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import {
  Document, Packer, Paragraph, HeadingLevel, TextRun,
  Table, TableRow, TableCell, WidthType, AlignmentType,
} from 'npm:docx@9.0.2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } })

const PHASE_NAMES: Record<number, string> = { 1: 'Diagnose', 2: 'Design', 3: 'Engage', 4: 'Embed', 5: 'Evaluate' }
const fmtDate = (d: string | Date | null) => d ? new Date(d).toLocaleDateString('en', { day: 'numeric', month: 'short', year: 'numeric' }) : '—'

// Is this schedule due right now? (UTC; the function runs hourly.)
function isDue(s: any, now: Date) {
  if (!s.enabled) return false
  if (now.getUTCHours() < (s.hour ?? 6)) return false
  const last = s.last_run_at ? new Date(s.last_run_at) : null
  if (last && last.toISOString().slice(0, 10) === now.toISOString().slice(0, 10)) return false   // already ran today
  if (s.cadence === 'monthly') return now.getUTCDate() === (s.day_of_month ?? 1)
  if (s.cadence === 'weekly') return now.getUTCDay() === (s.day_of_week ?? 1)
  if (s.cadence === 'fortnightly') {
    if (now.getUTCDay() !== (s.day_of_week ?? 1)) return false
    return !last || (now.getTime() - last.getTime()) >= 13 * 864e5
  }
  return false
}

// ── Small docx helpers ──
const H1 = (t: string) => new Paragraph({ text: t, heading: HeadingLevel.HEADING_1, spacing: { after: 160 } })
const H2 = (t: string) => new Paragraph({ text: t, heading: HeadingLevel.HEADING_2, spacing: { before: 240, after: 120 } })
const P = (t: string, opts: any = {}) => new Paragraph({ children: [new TextRun({ text: t, ...opts })], spacing: { after: 100 } })
const cell = (t: string, bold = false) => new TableCell({
  children: [new Paragraph({ children: [new TextRun({ text: t, bold })] })],
  margins: { top: 60, bottom: 60, left: 100, right: 100 },
})
const table = (headers: string[], rows: string[][]) => new Table({
  width: { size: 100, type: WidthType.PERCENTAGE },
  rows: [
    new TableRow({ tableHeader: true, children: headers.map(h => cell(h, true)) }),
    ...rows.map(r => new TableRow({ children: r.map(c => cell(c)) })),
  ],
})

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  try {
    const url = Deno.env.get('SUPABASE_URL')!
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || Deno.env.get('SB_SERVICE_ROLE_KEY') || ''
    const cronSecret = Deno.env.get('REPORT_CRON_SECRET') ?? ''
    const admin = createClient(url, serviceKey)

    const body = await req.json().catch(() => ({}))

    // ── Authorize ──
    let source: 'scheduled' | 'manual' = 'scheduled'
    let authorized = false
    if (cronSecret && req.headers.get('x-cron-secret') === cronSecret) {
      authorized = true
    } else {
      const caller = createClient(url, anonKey, { global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } } })
      const { data: { user } } = await caller.auth.getUser()
      if (user) {
        const { data: p } = await caller.from('profiles').select('is_admin').eq('id', user.id).single()
        if (p?.is_admin) { authorized = true; source = 'manual' }
      }
    }
    if (!authorized) return json({ error: 'unauthorized' }, 401)

    // ── Decide what to build ──
    const now = new Date()
    let jobs: { schedule: any | null; client_id: string; project_id: string | null }[] = []
    if (body.scheduleId) {
      const { data: s } = await admin.from('report_schedules').select('*').eq('id', body.scheduleId).single()
      if (!s) return json({ error: 'schedule not found' }, 404)
      jobs = [{ schedule: s, client_id: s.client_id, project_id: s.project_id }]
    } else if (body.clientId) {
      jobs = [{ schedule: null, client_id: body.clientId, project_id: body.projectId ?? null }]
    } else {
      const { data: all } = await admin.from('report_schedules').select('*').eq('enabled', true)
      jobs = (all ?? []).filter(s => isDue(s, now)).map(s => ({ schedule: s, client_id: s.client_id, project_id: s.project_id }))
    }
    if (jobs.length === 0) return json({ ok: true, generated: 0, note: 'nothing due' })

    // ── Load the picture once (service role; we scope per job below) ──
    const q = async (t: string, sel: string) => (await admin.from(t).select(sel)).data ?? []
    const [clients, projects, phases, pathways, members, milestones, acts, profiles] = await Promise.all([
      q('clients', 'id, name'), q('projects', 'id, name, client_id'),
      q('project_phases', 'project_id, phase_number, status, planned_start, planned_end'),
      q('project_pathways', 'project_id, phase_number, content_id'),
      q('project_members', 'project_id, user_id'),
      q('project_milestones', 'project_id, name, milestone_date'),
      q('user_activities', 'user_id, content_id, status'),
      q('profiles', 'id, full_name'),
    ])
    let surveyRows: any[] = []
    try { surveyRows = (await admin.from('survey_responses').select('user_id, score')).data ?? [] } catch { /* optional */ }

    const results: any[] = []
    for (const job of jobs) {
      const client = (clients as any[]).find(c => c.id === job.client_id)
      if (!client) continue
      const cps = (projects as any[]).filter((p: any) => p.client_id === job.client_id && (!job.project_id || p.id === job.project_id))
      const scopeLabel = job.project_id ? `${client.name} — ${cps[0]?.name ?? 'Project'}` : client.name

      // Per-project rollup
      const rollup = cps.map((p: any) => {
        const pm = (members as any[]).filter((m: any) => m.project_id === p.id).map((m: any) => m.user_id)
        const pw = (pathways as any[]).filter((w: any) => w.project_id === p.id)
        const steps = pw.length
        const total = steps * pm.length
        const done = (acts as any[]).filter((a: any) => a.status === 'completed' && pm.includes(a.user_id) && pw.some((w: any) => w.content_id === a.content_id)).length
        const ph = (phases as any[]).filter((x: any) => x.project_id === p.id).sort((a: any, b: any) => a.phase_number - b.phase_number)
          .map((x: any) => {
            const pwp = pw.filter((w: any) => w.phase_number === x.phase_number)
            const tot = pwp.length * pm.length
            const dn = (acts as any[]).filter((a: any) => a.status === 'completed' && pm.includes(a.user_id) && pwp.some((w: any) => w.content_id === a.content_id)).length
            return { ...x, name: PHASE_NAMES[x.phase_number] ?? `Phase ${x.phase_number}`, pct: tot > 0 ? Math.round((dn / tot) * 100) : 0, steps: pwp.length }
          })
        return { ...p, memberIds: pm, members: pm.length, pct: total > 0 ? Math.round((done / total) * 100) : 0, phases: ph }
      })

      const people = new Set(rollup.flatMap((p: any) => p.memberIds)).size
      const pct = rollup.length ? Math.round(rollup.reduce((s: number, p: any) => s + p.pct, 0) / rollup.length) : 0
      const overdue = rollup.flatMap((p: any) => p.phases.filter((x: any) => x.planned_end && new Date(x.planned_end) < now && x.pct < 100 && x.steps > 0).map((x: any) => ({ ...x, project: p.name })))
      const soon = new Date(now.getTime() + 30 * 864e5)
      const upcoming = (milestones as any[]).filter((m: any) => cps.some((p: any) => p.id === m.project_id) && m.milestone_date && new Date(m.milestone_date) >= now && new Date(m.milestone_date) <= soon)
        .sort((a: any, b: any) => new Date(a.milestone_date).getTime() - new Date(b.milestone_date).getTime())
      const memberIds = new Set(rollup.flatMap((p: any) => p.memberIds))
      const scores = (surveyRows as any[]).filter((s: any) => memberIds.has(s.user_id) && s.score != null)
      const avg = scores.length ? scores.reduce((s: number, r: any) => s + r.score, 0) / scores.length : null
      const rag = avg == null ? 'not yet measured' : avg >= 3.5 ? 'Green — on track' : avg >= 2.5 ? 'Amber — at risk' : 'Red — critical'

      // Stakeholder heat map (current artifact for this client)
      let heat: any = null
      const { data: arts } = await admin.from('change_artifacts').select('data, version')
        .eq('client_id', job.client_id).eq('type', 'stakeholder_heatmap').eq('is_current', true)
        .order('version', { ascending: false }).limit(1)
      if (arts?.[0]?.data?.rows) heat = arts[0]

      // ── Build the document ──
      const kids: any[] = [
        H1(`Change Report — ${scopeLabel}`),
        P(`Generated ${fmtDate(now)}${job.project_id ? ' · project scope' : ' · all programmes'} · grounded in live ChangeFlow data`, { italics: true, color: '666666' }),

        H2('Executive summary'),
        P(`${scopeLabel} covers ${rollup.length} programme${rollup.length === 1 ? '' : 's'} with ${people} ${people === 1 ? 'person' : 'people'} engaged, at ${pct}% average completion. Readiness is ${rag}.` +
          (overdue.length ? ` ${overdue.length} phase${overdue.length === 1 ? ' is' : 's are'} overdue and require attention.` : ' No phases are currently overdue.')),

        H2('Programme snapshot'),
        table(['Programme', 'People', 'Complete'], rollup.map((p: any) => [p.name, String(p.members), `${p.pct}%`])),
      ]

      rollup.forEach((p: any) => {
        kids.push(H2(`${p.name} — phases`))
        kids.push(table(['Phase', 'Status', 'Planned start', 'Planned end', 'Complete'],
          p.phases.map((x: any) => [`${x.phase_number}. ${x.name}`, x.status ?? '—', fmtDate(x.planned_start), fmtDate(x.planned_end), `${x.pct}%`])))
      })

      kids.push(H2('Needs attention'))
      kids.push(overdue.length
        ? table(['Phase', 'Programme', 'Complete'], overdue.map((x: any) => [x.name, x.project, `${x.pct}%`]))
        : P('Everything is on track — no overdue phases.'))

      kids.push(H2('Upcoming (next 30 days)'))
      kids.push(upcoming.length
        ? table(['Milestone', 'Date'], upcoming.map((m: any) => [m.name, fmtDate(m.milestone_date)]))
        : P('Nothing scheduled in the next 30 days.'))

      kids.push(H2('Readiness'))
      kids.push(P(avg == null
        ? 'Readiness has not been measured yet — no survey responses captured for this scope.'
        : `Average readiness is ${avg.toFixed(1)} out of 5 (${rag}), from ${scores.length} response${scores.length === 1 ? '' : 's'}.`))

      if (heat) {
        kids.push(H2('Stakeholder impact'))
        const cols = heat.data.cols ?? []
        kids.push(table(['Group', ...cols], (heat.data.rows ?? []).map((r: any) => [r.label, ...(r.cells ?? []).map((c: string) => (
          { vh: 'Very High', h: 'High', m: 'Medium', l: 'Low', vl: 'Very Low', none: 'None' } as any)[c] ?? '—')])))
      }

      kids.push(H2('Recommendations'))
      const recs: string[] = []
      if (overdue.length) recs.push(`Clear the ${overdue.length} overdue phase${overdue.length === 1 ? '' : 's'} — they gate downstream delivery.`)
      if (avg == null) recs.push('Run the phase readiness survey to establish a baseline; readiness is currently unmeasured.')
      else if (avg < 3.5) recs.push('Lift readiness with targeted engagement and comms before the next gate.')
      if (upcoming.length) recs.push(`Prepare for "${upcoming[0].name}" on ${fmtDate(upcoming[0].milestone_date)}.`)
      if (!recs.length) recs.push('On track — maintain cadence and continue capturing progress.')
      recs.forEach(r => kids.push(new Paragraph({ text: r, bullet: { level: 0 }, spacing: { after: 80 } })))

      const doc = new Document({ sections: [{ children: kids }] })
      const buf = await Packer.toBuffer(doc)

      const stamp = now.toISOString().slice(0, 10)
      const safe = scopeLabel.replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '')
      const filename = `${safe}-change-report-${stamp}.docx`
      const path = `${job.client_id}/${filename}`

      const { error: upErr } = await admin.storage.from('reports').upload(path, buf, {
        contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        upsert: true,
      })
      if (upErr) { results.push({ client: client.name, error: upErr.message }); continue }

      await admin.from('report_files').insert({
        schedule_id: job.schedule?.id ?? null, client_id: job.client_id, project_id: job.project_id,
        title: `Change Report — ${scopeLabel}`, filename, path,
        size_bytes: (buf as Uint8Array).byteLength ?? null, format: 'docx', source,
      })
      if (job.schedule) await admin.from('report_schedules').update({ last_run_at: now.toISOString() }).eq('id', job.schedule.id)

      results.push({ client: client.name, filename, size: (buf as Uint8Array).byteLength })
    }

    return json({ ok: true, generated: results.length, results })
  } catch (e) {
    return json({ error: String(e) }, 500)
  }
})
