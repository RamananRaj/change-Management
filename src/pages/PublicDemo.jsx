import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { summariseComms } from '../lib/ai/analysis'

// ChangeFlow — public CORA demo (/try)
// ============================================================================
// An anonymous visitor asks CORA five real questions against the real Meridian
// programme, and gets the real answers.
//
// NO MODEL IS CALLED. CORA's rules tier computes its answers from programme data;
// the model is a last resort for free text it cannot ground. Because the questions
// here are fixed, everything stays in the computed tier — which means no tokens,
// no cost per visitor, nothing to prompt-inject, and the same answer every time.
// That last part matters most when someone is presenting this live.
//
// The data arrives from the `demo-data` Edge Function, which reads Meridian
// server-side with the service key and returns an allow-listed shape. The browser
// never touches the tenant database, so no anonymous read path was opened to make
// this work.
//
// Free text is deliberately not offered. "Ask your own question, about your own
// programme" is the call to action, which turns the limitation into the pitch.

const TEAL = '#1C7293', GOLD = '#E8913A'
const fnUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/demo-data`

const QUESTIONS = [
  { id: 'tracking',  q: 'How is Meridian tracking?' },
  { id: 'golive',    q: 'Are we ready for go-live?' },
  { id: 'audiences', q: 'Which audiences carry the most change?' },
  { id: 'comms',     q: "What's blocked in the comms plan?" },
  { id: 'timeline',  q: 'Show me the change timeline across the programme' },
]

// What CORA says while it works. The real canvas reports progress through an
// onProgress callback as each source is read; these mirror the sources each
// question actually touches, so the wait describes real work rather than stalling.
const THINKING = {
  tracking:  ['Reading phase scope…', 'Rolling up completion…'],
  golive:    ['Reading audiences…', 'Checking impact assessments…', 'Checking the comms plan…'],
  audiences: ['Reading the audience register…', 'Scoring four impact domains…'],
  comms:     ['Reading the comms schedule…', 'Separating blocked from late…'],
  timeline:  ['Reading milestones…', 'Placing them across swimlanes…'],
}

// Follow-ups turn this from a lookup into a conversation — and each one is chosen
// to lead somewhere the product is strong, the way a good demo would.
const FOLLOWUP_LABEL = {
  tracking:  'How is Meridian tracking?',
  golive:    'Are we ready for go-live?',
  audiences: 'Which audiences carry the most change?',
  comms:     "What's blocked in the comms plan?",
  timeline:  'Show me the change timeline across the programme',
}

const PHASE_NAMES = { 1: 'Diagnose', 2: 'Design', 3: 'Engage', 4: 'Embed', 5: 'Evaluate' }
const fmtDate = d => d ? new Date(d + 'T00:00:00').toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' }) : null

// ─── answer builders ────────────────────────────────────────────────────────
// Each returns { lead, stats?, rows?, gap?, source }. `gap` is the point of the
// whole exercise: what the number does not cover, said out loud.

function answerTracking(d) {
  const inScope = d.phases.filter(p => p.lane_id)
  const done    = inScope.filter(p => p.status === 'completed').length
  const active  = inScope.find(p => p.status === 'active')
  const pct     = inScope.length ? Math.round((done / inScope.length) * 100) : null
  const deferred = d.phases.filter(p => !p.lane_id)
  return {
    lead: pct == null
      ? `**${d.project.name}** has no phases in scope yet, so there is no completion figure to give you.`
      : `**${d.project.name}** is **${pct}% complete** across the ${inScope.length} phases this programme runs${active ? `, with **${PHASE_NAMES[active.phase_number]}** underway` : ''}.`,
    stats: [
      { v: pct == null ? '—' : `${pct}%`, k: `Across ${inScope.length} phases in scope` },
      { v: `${done}/${inScope.length}`,   k: 'Phases closed' },
    ],
    gap: deferred.length
      ? `${deferred.length} of the five phases are **not part of this programme**. They are excluded from that percentage rather than sitting at 0% and dragging it down.`
      : null,
    next: ['golive', 'timeline'],
    source: `${inScope.length} phases · ${d.milestones.length} milestones`,
  }
}

function answerGoLive(d) {
  const unrated = (d.audiences ?? []).filter(a =>
    !a.impact_people && !a.impact_process && !a.impact_information && !a.impact_technology)
  const c = summariseComms(d.comms.map(x => ({ ...x, derived_status: x.derived_status })))
  const gl = d.milestones.find(m => /go.?live/i.test(m.name || ''))
  const head = (d.audiences ?? []).reduce((n, a) => n + (a.headcount ?? 0), 0)
  return {
    lead: `Not a straight yes — and part of the reason is that I cannot see all of it.${gl ? ` Go-Live is set for **${fmtDate(gl.milestone_date ?? gl.ends_on ?? gl.starts_on)}**.` : ''}`,
    stats: [
      { v: String(d.audiences.length), k: 'Audiences identified' },
      { v: head ? head.toLocaleString() : '—', k: 'People impacted' },
      { v: String(c.blocked + c.overdue), k: 'Comms not out' },
    ],
    gap: unrated.length
      ? `**${unrated.map(a => a.name).join(', ')}** ${unrated.length === 1 ? 'has' : 'have'} no impact assessment. ${unrated.length === 1 ? 'It is' : 'They are'} not counted as low — ${unrated.length === 1 ? 'it is' : 'they are'} simply not assessed, and any readiness figure that ignored that would be flattering.`
      : 'Every audience has been assessed, so nothing is hidden behind an average.',
    next: ['audiences', 'comms'],
    source: `${d.audiences.length} audiences · ${d.comms.length} comms items`,
  }
}

function answerAudiences(d) {
  const ranked = (d.audiences ?? [])
    .map(a => {
      const vals = [a.impact_people, a.impact_process, a.impact_information, a.impact_technology]
      const score = vals.reduce((n, v) => n + (v === 'h' ? 3 : v === 'm' ? 2 : v === 'l' ? 1 : 0), 0)
      const rated = vals.filter(Boolean).length
      return { ...a, score, rated }
    })
    .sort((a, b) => b.score - a.score)
  const top = ranked.filter(a => a.rated).slice(0, 4)
  const unrated = ranked.filter(a => !a.rated)
  return {
    lead: top.length
      ? `**${top[0].name}** carries the most change${top[0].headcount ? ` — ${top[0].headcount.toLocaleString()} people` : ''}, rated across people, process, information and technology.`
      : 'No audience has been rated yet, so there is nothing to rank.',
    rows: top.map(a => ({
      label: a.name,
      meta: a.headcount ? `${a.headcount.toLocaleString()} people` : 'headcount not set',
      cells: [a.impact_people, a.impact_process, a.impact_information, a.impact_technology],
    })),
    gap: unrated.length
      ? `${unrated.length} audience${unrated.length === 1 ? '' : 's'} — ${unrated.map(a => a.name).join(', ')} — ${unrated.length === 1 ? 'is' : 'are'} unrated. Shown as *not assessed*, never as low impact.`
      : null,
    next: ['golive', 'comms'],
    source: `${d.audiences.length} audiences · 4 impact domains`,
  }
}

function answerComms(d) {
  const s = summariseComms(d.comms)
  const blocked = d.comms.filter(c => c.derived_status === 'blocked')
  const overdue = d.comms.filter(c => c.derived_status === 'overdue')
  return {
    lead: blocked.length || overdue.length
      ? `${blocked.length} blocked, ${overdue.length} overdue — and those are **different problems with different owners**.`
      : 'Nothing is blocked or overdue in the comms plan.',
    rows: [
      ...blocked.map(c => ({ label: c.message, meta: `Blocked — waiting on ${c.depends_name ?? 'an upstream output'}`, tone: 'block' })),
      ...overdue.map(c => ({ label: c.message, meta: `Overdue — nothing is blocking it${c.has_owner ? '' : ', and it has no owner'}`, tone: 'over' })),
    ],
    stats: [
      { v: String(s.sent),    k: 'Sent' },
      { v: String(s.blocked), k: 'Blocked' },
      { v: String(s.overdue), k: 'Overdue' },
      { v: String(s.planned), k: 'Planned' },
    ],
    gap: blocked.length
      ? 'A blocked message is not late — it is waiting on something upstream. Chasing the sender would achieve nothing.'
      : null,
    next: ['timeline', 'golive'],
    source: `${d.comms.length} items anchored to milestones`,
  }
}

// The whole programme on one timeline — change and delivery in the same view,
// which is the argument the product makes against a borrowed project tool.
function answerTimeline(d) {
  const dated = (d.milestones ?? [])
    .map(m => ({ ...m, on: m.milestone_date ?? m.ends_on ?? m.starts_on }))
    .filter(m => m.on)
    .sort((a, b) => String(a.on).localeCompare(String(b.on)))
  const undated = (d.milestones ?? []).filter(m => !(m.milestone_date ?? m.ends_on ?? m.starts_on))
  const gl = dated.find(m => /go.?live/i.test(m.name || ''))
  const laneNames = [...new Set(dated.map(m => m.lane).filter(Boolean))]
  const span = dated.length
    ? `${fmtDate(dated[0].on)} to ${fmtDate(dated[dated.length - 1].on)}`
    : null

  return {
    lead: dated.length
      ? `The whole programme sits on one timeline — **${laneNames.length || d.lanes.length} swimlane${(laneNames.length || d.lanes.length) === 1 ? '' : 's'}**, change and delivery together, running ${span}.${gl ? ` Go-Live is **${fmtDate(gl.on)}**.` : ''}`
      : 'Nothing on the timeline carries a date yet, so there is no sequence to show you.',
    stats: [
      { v: String(dated.length), k: 'Milestones scheduled' },
      { v: String(laneNames.length || d.lanes.length), k: 'Swimlanes' },
      { v: gl ? fmtDate(gl.on).replace(/ \d{4}$/, '') : '—', k: 'Go-Live' },
    ],
    rows: dated.slice(0, 7).map(m => ({
      label: m.name,
      meta: `${m.lane ? m.lane + ' · ' : ''}${fmtDate(m.on)}`,
      tone: /go.?live/i.test(m.name) ? 'gl' : null,
    })),
    gap: undated.length
      ? `${undated.length} milestone${undated.length === 1 ? '' : 's'} ${undated.length === 1 ? 'has' : 'have'} no date — ${undated.map(m => m.name).join(', ')}. Not assumed to be on time; simply unscheduled, and nothing can be anchored to ${undated.length === 1 ? 'it' : 'them'} until ${undated.length === 1 ? 'it has' : 'they have'} one.`
      : 'Every milestone carries a date, so every comm and activity anchored to one moves when it moves.',
    next: ['comms', 'tracking'],
    source: `${d.milestones.length} milestones · ${d.lanes.length} lanes`,
  }
}

const BUILDERS = { tracking: answerTracking, golive: answerGoLive, audiences: answerAudiences, comms: answerComms, timeline: answerTimeline }

const HEAT = { h: ['High', '#FEE2E2', '#B32B2E'], m: ['Med', '#FEF0DC', '#9C5A11'], l: ['Low', '#DCFCE7', '#0E7C5A'] }

// ─── page ───────────────────────────────────────────────────────────────────
export default function PublicDemo() {
  const [data, setData]   = useState(null)
  const [err, setErr]     = useState(null)
  const [typed, setTyped] = useState('')       // what appears in the ask box
  const [asked, setAsked] = useState(null)     // the question actually answered
  const [thinking, setThinking] = useState(false)
  const [step, setStep] = useState(null)      // which source CORA is reading
  const [answer, setAnswer] = useState(null)
  const timers = useRef([])

  useEffect(() => {
    fetch(fnUrl, { headers: { apikey: import.meta.env.VITE_SUPABASE_ANON_KEY ?? '' } })
      .then(r => r.ok ? r.json() : Promise.reject(new Error(String(r.status))))
      .then(setData)
      .catch(() => setErr('The demo data is unavailable right now.'))
    return () => timers.current.forEach(clearTimeout)
  }, [])

  // Type the question into the ask box a character at a time, then answer it.
  // The typing is the point: it shows CORA being *asked*, rather than a list of
  // canned Q&A. Deliberately quick — 18ms a character, not a performance.
  function pick(q) {
    if (thinking || !data) return
    timers.current.forEach(clearTimeout); timers.current = []
    setAnswer(null); setAsked(null); setTyped(''); setStep(null)
    ;[...q.q].forEach((_, i) => {
      timers.current.push(setTimeout(() => setTyped(q.q.slice(0, i + 1)), i * 18))
    })
    const typeMs = q.q.length * 18
    timers.current.push(setTimeout(() => { setThinking(true); setAsked(q.q) }, typeMs + 120))

    // Walk the progress lines, then answer. Each step names a source it actually
    // reads, so the wait is informative rather than a spinner pretending to be busy.
    const steps = THINKING[q.id] ?? ['Reading the programme…']
    steps.forEach((t, i) => {
      timers.current.push(setTimeout(() => setStep(t), typeMs + 160 + i * 420))
    })
    const doneMs = typeMs + 220 + steps.length * 420
    timers.current.push(setTimeout(() => {
      setThinking(false); setStep(null)
      setAnswer(BUILDERS[q.id](data))
      setTyped('')
    }, doneMs))
  }
  // Follow-ups arrive as an id; look the question back up so the ask box types the
  // same wording the chips use.
  const pickById = id => pick(QUESTIONS.find(x => x.id === id) ?? { id, q: FOLLOWUP_LABEL[id] ?? '' })

  const bold = t => String(t).split(/(\*\*[^*]+\*\*)/g).map((p, i) =>
    p.startsWith('**') ? <strong key={i} className="text-white">{p.slice(2, -2)}</strong> : <span key={i}>{p}</span>)

  return (
    <div className="min-h-screen" style={{ background: '#080D1C' }}>
      {/* nav */}
      <header className="flex items-center justify-between px-6 md:px-10 py-4 border-b border-white/10">
        <Link to="/" className="flex items-center gap-2.5">
          <span className="w-6 h-6 rounded-lg block" style={{ background: `linear-gradient(135deg, ${TEAL}, ${GOLD})` }} />
          <span className="text-white font-extrabold tracking-[0.16em] text-sm">CHANGEFLOW</span>
        </Link>
        <a href="/marketing#demo" className="text-white text-sm font-semibold px-4 py-2 rounded-lg" style={{ background: GOLD }}>
          Book a demo
        </a>
      </header>

      <main className="max-w-4xl mx-auto px-5 py-10 md:py-14">
        <div className="text-center mb-9">
          <span className="inline-block text-[11px] font-bold tracking-[0.14em] uppercase mb-3" style={{ color: GOLD }}>
            Live demo · real programme data
          </span>
          <h1 className="text-white text-3xl md:text-4xl font-extrabold tracking-tight mb-3">
            Ask CORA a real question.
          </h1>
          <p className="text-[15px] max-w-xl mx-auto leading-relaxed" style={{ color: 'rgba(216,231,239,.72)' }}>
            This is a real programme — Meridian Water's billing transformation — with real audiences,
            milestones and a live comms plan. Pick a question and watch CORA answer from the data,
            including the parts it can't see.
          </p>
        </div>

        {/* chips */}
        <div className="flex flex-wrap gap-2.5 justify-center mb-7">
          {QUESTIONS.map(q => (
            <button key={q.id} onClick={() => pick(q)} disabled={!data || thinking}
              className="text-[13.5px] font-semibold px-4 py-2.5 rounded-full border transition-colors disabled:opacity-40"
              style={{ borderColor: 'rgba(255,255,255,.18)', color: 'rgba(216,231,239,.92)', background: 'rgba(255,255,255,.05)' }}>
              {q.q}
            </button>
          ))}
        </div>

        {/* the ask box — the question types into it */}
        <div className="rounded-2xl border px-4 py-3.5 flex items-center gap-3 mb-7"
             style={{ borderColor: typed || thinking ? GOLD : 'rgba(255,255,255,.16)', background: 'rgba(255,255,255,.05)' }}>
          <span className="w-2 h-2 rounded-full flex-none" style={{ background: GOLD }} />
          <span className="text-[15px] flex-1 truncate" style={{ color: typed ? '#fff' : 'rgba(216,231,239,.42)' }}>
            {typed || asked || 'Ask CORA — pick a question above'}
            {typed && <span className="inline-block w-[2px] h-4 ml-0.5 align-middle animate-pulse" style={{ background: GOLD }} />}
          </span>
        </div>

        {err && <p className="text-center text-sm" style={{ color: '#F98080' }}>{err}</p>}
        {!data && !err && <p className="text-center text-sm" style={{ color: 'rgba(216,231,239,.5)' }}>Loading the programme…</p>}

        {thinking && (
          <div className="flex items-center gap-2.5 text-sm px-1" style={{ color: 'rgba(216,231,239,.6)' }}>
            <span className="flex gap-1">
              {[0, 1, 2].map(i => (
                <span key={i} className="w-1.5 h-1.5 rounded-full animate-bounce"
                      style={{ background: TEAL, animationDelay: `${i * 120}ms` }} />
              ))}
            </span>
            {step ?? 'Reading the programme…'}
          </div>
        )}

        {/* the answer */}
        {answer && (
          <div className="rounded-2xl border p-5 md:p-7" style={{ borderColor: 'rgba(255,255,255,.12)', background: 'rgba(255,255,255,.04)' }}>
            <div className="flex gap-3.5">
              <span className="w-8 h-8 rounded-lg grid place-items-center flex-none text-[11px] font-extrabold text-white"
                    style={{ background: `linear-gradient(135deg, ${TEAL}, ${GOLD})` }}>CO</span>
              <div className="flex-1 min-w-0">
                <p className="text-[15.5px] leading-relaxed" style={{ color: 'rgba(216,231,239,.9)' }}>{bold(answer.lead)}</p>

                {answer.stats && (
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5 mt-4">
                    {answer.stats.map((s, i) => (
                      <div key={i} className="rounded-xl border px-3.5 py-3" style={{ borderColor: 'rgba(255,255,255,.1)', background: 'rgba(255,255,255,.04)' }}>
                        <div className="text-white text-xl font-extrabold tracking-tight">{s.v}</div>
                        <div className="text-[11px] mt-0.5" style={{ color: 'rgba(216,231,239,.5)' }}>{s.k}</div>
                      </div>
                    ))}
                  </div>
                )}

                {answer.rows && answer.rows.length > 0 && (
                  <div className="mt-4 space-y-2">
                    {answer.rows.map((r, i) => (
                      <div key={i} className="flex items-start gap-3 rounded-xl px-3.5 py-2.5" style={{ background: 'rgba(255,255,255,.04)' }}>
                        <span className="w-1.5 h-1.5 rounded-full mt-2 flex-none"
                              style={{ background: r.tone === 'block' ? '#F59E0B' : r.tone === 'over' ? '#EF4444' : r.tone === 'gl' ? GOLD : TEAL }} />
                        <div className="flex-1 min-w-0">
                          <div className="text-[14px] text-white font-medium">{r.label}</div>
                          {r.meta && <div className="text-[12px] mt-0.5" style={{ color: 'rgba(216,231,239,.55)' }}>{r.meta}</div>}
                        </div>
                        {r.cells && (
                          <div className="flex gap-1 flex-none">
                            {r.cells.map((c, j) => {
                              const h = HEAT[c]
                              return h
                                ? <span key={j} className="text-[10px] font-bold px-1.5 py-1 rounded" style={{ background: h[1], color: h[2] }}>{h[0]}</span>
                                : <span key={j} className="text-[10px] font-semibold px-1.5 py-1 rounded border border-dashed"
                                        style={{ borderColor: 'rgba(255,255,255,.2)', color: 'rgba(216,231,239,.45)' }}>n/a</span>
                            })}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}

                {answer.gap && (
                  <div className="mt-4 flex gap-3 rounded-xl px-4 py-3.5 border"
                       style={{ background: 'rgba(232,145,58,.1)', borderColor: 'rgba(232,145,58,.28)', borderLeftWidth: 3, borderLeftColor: GOLD }}>
                    <span className="flex-none text-sm" style={{ color: GOLD }}>⚠</span>
                    <p className="text-[13.5px] leading-relaxed" style={{ color: 'rgba(216,231,239,.88)' }}>{bold(answer.gap)}</p>
                  </div>
                )}

                <p className="mt-4 pt-3 text-[11.5px] border-t" style={{ borderColor: 'rgba(255,255,255,.08)', color: 'rgba(216,231,239,.42)' }}>
                  Sources · {answer.source} · read from the live programme, no model called
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Follow-ups — the demo answers, then offers where to go next, which is how
            a real conversation with CORA actually runs. */}
        {answer?.next?.length > 0 && (
          <div className="mt-6">
            <p className="text-[12px] mb-2.5 px-1" style={{ color: 'rgba(216,231,239,.45)' }}>Ask next</p>
            <div className="flex flex-wrap gap-2.5">
              {answer.next.map(id => (
                <button key={id} onClick={() => pickById(id)} disabled={thinking}
                  className="text-[13px] font-semibold px-3.5 py-2 rounded-full border transition-colors disabled:opacity-40"
                  style={{ borderColor: 'rgba(232,145,58,.4)', color: GOLD, background: 'rgba(232,145,58,.08)' }}>
                  {FOLLOWUP_LABEL[id]}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* the ask that free text is deliberately not offered for */}
        {answer && (
          <div className="mt-8 text-center">
            <p className="text-[14.5px] mb-4" style={{ color: 'rgba(216,231,239,.7)' }}>
              Want to ask your own question, about your own programme?
            </p>
            <a href="/marketing#demo" className="inline-block text-white text-[15px] font-semibold px-7 py-3 rounded-xl" style={{ background: GOLD }}>
              Book a demo →
            </a>
          </div>
        )}
      </main>
    </div>
  )
}
