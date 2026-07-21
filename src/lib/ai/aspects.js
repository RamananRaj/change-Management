import { supabase } from '../supabase'
import {
  heatmapFromAudiences, analyseHeatmap, summariseCoverage, coverageVerdict,
  summariseDemand, GAP_REASON_LABEL,
} from './analysis'

// ─────────────────────────────────────────────────────────────────────────────
// THE ASPECT REGISTRY
// ─────────────────────────────────────────────────────────────────────────────
//
// WHY THIS EXISTS
//   Every way of asking CORA a question — the report, the story, a brief, a single
//   section — used to carry its own hand-written list of what to look at. So each new
//   capability had to be remembered in four places, and when it wasn't, the answer was
//   quietly incomplete. That happened three times: gates and comms were built and never
//   wired into the report, and the heat map went stale in the report while the canvas
//   showed live data. Three instances is a pattern, not bad luck.
//
//   Now there is one list. Every intent sweeps it. A capability that registers here is
//   in every answer by construction, and cannot be forgotten.
//
// THE THREE STATES — THE WHOLE POINT
//   An aspect never simply returns data or nothing. It returns one of:
//
//     present   we have it, here it is
//     partial   we have some of it, and here is exactly what is missing
//     absent    nothing captured, and here is what capturing it would tell you
//
//   'absent' is the state that did not exist before, and it is the important one. An
//   aspect with no data used to be invisible, so "how is Meridian tracking" read as a
//   complete answer while being silent on everything not yet populated. That is the
//   same failure as a blank rendering as 0%, one level up and worse — it shapes what
//   the reader believes they have been told.
//
// WHY THE WORDING LIVES IN THE ASPECT
//   Only the training aspect knows that an unsized audience blocks the percentage.
//   Only the gate aspect knows an unassessed unit is not a pass. A generic "no data
//   available" would throw away exactly the reasoning this product is built on.
//
// TWO REGISTERS
//   `note` is what CORA says to an internal audience: direct, names the gap, says what
//   to do. `clientNote` is the same fact for a client-facing pack: states scope without
//   reading as a list of failures. Same truth, different room.

export const ASPECT_STATE = { PRESENT: 'present', PARTIAL: 'partial', ABSENT: 'absent' }

// Helper so every aspect returns the same shape and none of them can forget a field.
const result = (state, o = {}) => ({
  state, section: null, note: null, clientNote: null, gaps: [], ...o,
})

// ─────────────────────────────────────────────────────────────────────────────
// Impact heat map — from audiences, falling back to a stored artifact
// ─────────────────────────────────────────────────────────────────────────────
const heatmapAspect = {
  key: 'heatmap',
  label: 'Change impact heat map',
  scope: 'project',
  async build({ projects, clientId, fmtDate }) {
    let built = null
    if (projects.length === 1) {
      const { data: auds } = await supabase.from('audiences')
        .select('name, sort_order, headcount, impact_people, impact_process, impact_information, impact_technology, impact_note, impact_rated_on')
        .eq('project_id', projects[0].id).order('sort_order')
      built = heatmapFromAudiences(auds ?? [])
    }

    if (built) {
      const shaped = { cols: built.cols, rows: built.rows, commentary: built.commentary }
      const insights = analyseHeatmap(shaped)
      const gaps = []
      if (built.missing.length) gaps.push(`${built.missing.join(', ')} ${built.missing.length === 1 ? 'has' : 'have'} not been rated`)
      if (built.unratedCells) gaps.push(`${built.unratedCells} domain rating${built.unratedCells === 1 ? '' : 's'} still blank`)
      const section = {
        heading: 'Change impact heat map', type: 'heatmap',
        cols: built.cols, rows: built.rows,
        source: built.ratedOn ? `audiences · rated ${fmtDate(built.ratedOn)}` : 'audiences',
        headline: built.commentary,
        insights: gaps.length ? [...insights, `**Gaps:** ${gaps.join('; ')}.`] : insights,
      }
      return gaps.length
        ? result(ASPECT_STATE.PARTIAL, { section, gaps,
            note: `The heat map is rated but incomplete — ${gaps.join(', and ')}. Until those are rated the overall impact picture understates the change.`,
            clientNote: `Impact assessment is in progress: ${gaps.join('; ')}.` })
        : result(ASPECT_STATE.PRESENT, { section })
    }

    // Older clients captured this by hand before audiences existed.
    if (clientId) {
      const { data: arts } = await supabase.from('change_artifacts')
        .select('title, version, source, data').eq('client_id', clientId)
        .eq('type', 'stakeholder_heatmap').eq('is_current', true)
        .order('version', { ascending: false }).limit(1)
      const a = arts?.[0]
      if (a) return result(ASPECT_STATE.PRESENT, { section: {
        heading: 'Change impact heat map', type: 'heatmap',
        cols: a.data.cols, rows: a.data.rows, version: a.version, source: a.source,
        headline: a.data.commentary, insights: analyseHeatmap(a.data) } })
    }

    return result(ASPECT_STATE.ABSENT, {
      note: 'No impact assessment yet. Rating each audience across People, Process, Information and Technology would show which groups absorb the most change — that is what drives who gets the most support.',
      clientNote: 'Change impact assessment — not yet captured.',
    })
  },
}

// ─────────────────────────────────────────────────────────────────────────────
// Training needs + coverage
// ─────────────────────────────────────────────────────────────────────────────
const trainingAspect = {
  key: 'training',
  label: 'Training',
  scope: 'project',
  async build({ projects, today }) {
    if (projects.length !== 1) return result(ASPECT_STATE.ABSENT, {
      note: 'Training is tracked per project — name one to see its coverage.',
      clientNote: null,
    })

    const pid = projects[0].id
    const [{ data: cov }, { data: mods }] = await Promise.all([
      supabase.from('training_coverage').select('*').eq('project_id', pid),
      supabase.from('training_modules').select('id, name, status').eq('project_id', pid),
    ])

    if (!mods?.length) return result(ASPECT_STATE.ABSENT, {
      note: 'No training modules defined. Listing what each group has to be able to do after go-live turns training from a guess into a number — and it is usually the first thing a readiness gate asks for.',
      clientNote: 'Training needs analysis — not yet captured.',
    })

    if (!cov?.length) return result(ASPECT_STATE.PARTIAL, {
      gaps: ['no needs mapped'],
      note: `${mods.length} training module${mods.length === 1 ? ' exists' : 's exist'} but none are mapped to an audience yet, so there is no demand to report against. The matrix is the analysis — without it, coverage cannot be computed.`,
      clientNote: 'Training modules are defined; the needs matrix is still being completed.',
    })

    const summary = summariseCoverage(cov, { asOf: today })
    const verdict = coverageVerdict(summary)
    const demand  = summariseDemand(cov)

    const rows = cov.filter(r => r.necessity === 'mandatory')
      .sort((a, b) => (a.pct ?? -1) - (b.pct ?? -1))
      .map(r => ({
        rag: r.pct == null ? 'a' : r.pct >= 95 ? 'g' : r.pct >= 60 ? 'a' : 'r',
        name: `${r.audience_name} · ${r.module_name}`,
        meta: r.pct == null
          // Never a bare blank: the row states why it has no percentage, using the
          // same reason the screen shows, so the two cannot explain it differently.
          ? (GAP_REASON_LABEL[r.gap_reason] ?? 'not reportable')
          : `${r.trained} of ${r.people_needed}`,
        due: r.pct == null ? '—' : `${r.pct}%`,
      }))

    const section = {
      heading: 'Training coverage', type: 'list', rows,
      empty: 'No mandatory training needs.',
      headline: summary.pct == null
        ? 'No mandatory training coverage is reportable yet.'
        : `**${summary.pct}%** of mandatory training places delivered — ${summary.trained} of ${summary.needed}. Gate view: **${verdict.verdict === 'pass' ? 'on track' : verdict.verdict === 'incomplete' ? 'incomplete picture' : verdict.verdict}**. ${verdict.why}`,
    }

    const gaps = []
    if (summary.unreported) gaps.push(`${summary.unreported} need${summary.unreported === 1 ? ' has' : 's have'} never been reported`)
    if (demand.unsizedGroups.length) gaps.push(`${demand.unsizedGroups.join(', ')} ${demand.unsizedGroups.length === 1 ? 'has' : 'have'} no headcount, so demand cannot be sized`)
    if (summary.stale.length) gaps.push(`${summary.stale.length} check${summary.stale.length === 1 ? ' is' : 's are'} more than three weeks old`)
    if (summary.blocked.length) gaps.push(`${summary.blocked.length} need${summary.blocked.length === 1 ? ' is' : 's are'} blocked on material that should already be delivering`)

    if (!gaps.length) return result(ASPECT_STATE.PRESENT, { section })

    return result(ASPECT_STATE.PARTIAL, { section, gaps,
      // The distinction the whole training build exists to protect, said in a sentence.
      note: `Training coverage is ${summary.pct == null ? 'not yet reportable' : `${summary.pct}%`}, but the picture is incomplete: ${gaps.join('; ')}. ` +
        (summary.blocked.length ? 'The blocked items are on the programme, not on the leaders — nobody can train people on material that does not exist. ' : '') +
        'A coverage number quoted at a gate while needs are unreported is not a pass.',
      clientNote: `Training coverage${summary.pct == null ? '' : ` is at ${summary.pct}% of mandatory places`}. Still to complete: ${gaps.join('; ')}.`,
    })
  },
}

// ─────────────────────────────────────────────────────────────────────────────
// Business readiness gate
// ─────────────────────────────────────────────────────────────────────────────
const gateAspect = {
  key: 'gate',
  label: 'Business readiness gate',
  scope: 'client',
  async build({ clientId, fmtDate }) {
    if (!clientId) return result(ASPECT_STATE.ABSENT, { note: 'No client in scope for a readiness gate.' })
    const { data: arts } = await supabase.from('change_artifacts')
      .select('data, source').eq('client_id', clientId).eq('type', 'readiness_gate').eq('is_current', true).limit(1)
    const g = arts?.[0]?.data
    if (!g) return result(ASPECT_STATE.ABSENT, {
      note: 'No readiness gate defined. A gate turns "are we ready?" from an opinion into a per-business-unit checklist with an owner and a date — and it is the natural place for the training and impact numbers to land.',
      clientNote: 'Business readiness gate — not yet defined.',
    })

    const units = g.units ?? []
    const notAssessed = units.filter(u => u.status === 'not_assessed')
    const atRisk = units.filter(u => u.status === 'at_risk' || u.status === 'watch')
    const section = {
      heading: 'Business readiness gate', type: 'list',
      headline: `**${g.gate_name ?? 'Readiness gate'}** — decision due ${g.decision_due ? fmtDate(g.decision_due) : 'TBC'}${g.owner ? `, owned by ${g.owner}` : ''}. Verdict: **${g.verdict ?? 'not set'}**.`,
      rows: units.map(u => ({
        rag: u.status === 'ready' ? 'g' : u.status === 'not_assessed' ? 'a' : u.status === 'at_risk' ? 'r' : 'a',
        name: u.unit,
        // An unassessed unit shows its criteria count but never reads as a score —
        // "2 of 6" on an unstarted assessment would look like partial progress.
        meta: u.status === 'not_assessed' ? 'not assessed' : `${u.met} of ${u.total} criteria`,
        due: u.open ?? (u.status === 'ready' ? 'ready' : ''),
      })),
      empty: 'No business units assessed.',
    }

    const gaps = []
    if (notAssessed.length) gaps.push(`${notAssessed.map(u => u.unit).join(', ')} ${notAssessed.length === 1 ? 'has' : 'have'} not been assessed at all`)
    if (atRisk.length) gaps.push(`${atRisk.length} unit${atRisk.length === 1 ? ' is' : 's are'} short of criteria`)
    if (!gaps.length) return result(ASPECT_STATE.PRESENT, { section })
    return result(ASPECT_STATE.PARTIAL, { section, gaps,
      note: `The gate is not a clean pass: ${gaps.join('; ')}. An unassessed unit is not the same as a ready one, and the gate cannot be called until it is measured either way.`,
      clientNote: `Readiness assessment is in progress: ${gaps.join('; ')}.`,
    })
  },
}

// ─────────────────────────────────────────────────────────────────────────────
// Comms plan
// ─────────────────────────────────────────────────────────────────────────────
const commsAspect = {
  key: 'comms',
  label: 'Comms plan',
  scope: 'client',
  async build({ clientId, fmtDate }) {
    if (!clientId) return result(ASPECT_STATE.ABSENT, { note: 'No client in scope for a comms plan.' })
    const { data: arts } = await supabase.from('change_artifacts')
      .select('data').eq('client_id', clientId).eq('type', 'comms_plan').eq('is_current', true).limit(1)
    const c = arts?.[0]?.data
    if (!c) return result(ASPECT_STATE.ABSENT, {
      note: 'No comms plan captured. Anchoring each message to a milestone rather than a fixed date means the whole cascade moves when go-live moves — which is the failure mode of every comms plan kept in a spreadsheet.',
      clientNote: 'Communications plan — not yet captured.',
    })

    const items = c.items ?? []
    const blocked = items.filter(i => i.status === 'blocked')
    const unowned = items.filter(i => !i.owner)
    const section = {
      heading: 'Comms plan', type: 'list',
      headline: `Anchored to **${c.anchor ?? 'go-live'}**${c.anchor_date ? ` (${fmtDate(c.anchor_date)})` : ''} — ${items.length} planned message${items.length === 1 ? '' : 's'}.`,
      rows: items.map(i => ({
        rag: i.status === 'sent' ? 'g' : i.status === 'blocked' ? 'r' : 'a',
        name: i.message,
        meta: `${i.audience}${i.size ? ` · ${i.size}` : ''} · ${i.channel}`,
        due: i.date ? fmtDate(i.date) : '—',
      })),
      empty: 'No comms items.',
    }

    const gaps = []
    if (blocked.length) gaps.push(`${blocked.length} item${blocked.length === 1 ? ' is' : 's are'} blocked (${blocked.map(i => i.source ?? i.message).join('; ')})`)
    if (unowned.length) gaps.push(`${unowned.length} item${unowned.length === 1 ? ' has' : 's have'} no owner`)
    if (!gaps.length) return result(ASPECT_STATE.PRESENT, { section })
    return result(ASPECT_STATE.PARTIAL, { section, gaps,
      note: `The comms plan has gaps: ${gaps.join('; ')}. An unowned message near go-live is one nobody sends.`,
      clientNote: `Communications plan is in place, with ${gaps.join('; ')}.`,
    })
  },
}

// ─────────────────────────────────────────────────────────────────────────────
// Benefits — nothing built yet, and that is the honest answer
// ─────────────────────────────────────────────────────────────────────────────
// Registered deliberately while unbuilt. Before the registry, an unbuilt capability was
// indistinguishable from one with no data, and both were invisible — so a programme
// with no benefits tracking read as a programme with nothing to say about benefits.
const benefitsAspect = {
  key: 'benefits',
  label: 'Benefits realisation',
  scope: 'project',
  async build() {
    return result(ASPECT_STATE.ABSENT, {
      note: 'Benefits are not tracked in ChangeFlow yet. Without a baseline and a target per benefit, the programme can report that it delivered the change but not that the change was worth making — which is the question asked six months after go-live.',
      clientNote: 'Benefits realisation — not yet tracked in this platform.',
    })
  },
}

// ─────────────────────────────────────────────────────────────────────────────
export const ASPECTS = [heatmapAspect, trainingAspect, gateAspect, commsAspect, benefitsAspect]

// Sweeps every registered aspect. One failing aspect must not take down the answer —
// a broken heat map should cost the heat map section, not the whole report.
export async function sweepAspects(ctx, { only = null } = {}) {
  const list = only ? ASPECTS.filter(a => only.includes(a.key)) : ASPECTS
  const settled = await Promise.all(list.map(async a => {
    try {
      const r = await a.build(ctx)
      return { key: a.key, label: a.label, ...r }
    } catch (err) {
      return { key: a.key, label: a.label, state: ASPECT_STATE.ABSENT, section: null, gaps: [],
        note: `${a.label} could not be read (${err?.message ?? 'unknown error'}). Treat it as unknown rather than as nothing.`,
        clientNote: null }
    }
  }))
  return settled
}
