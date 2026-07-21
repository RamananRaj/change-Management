import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { summariseCoverage, coverageTrend, coverageVerdict, isStale,
         daysBetween, GAP_REASON_LABEL, MODULE_STATUS_LABEL } from '../lib/ai/analysis'

// Final step of the people-leader training build: coverage on screen.
//
// The screen answers one question per row — "how many of this group are through this
// module, and when did we last ask?" — and refuses to answer it when it can't.
// Nobody is named anywhere: the leader reports a count for their group.

const VERDICT_STYLE = {
  pass:       { bg: 'bg-green-50',  text: 'text-green-700',  label: 'On track' },
  short:      { bg: 'bg-amber-50',  text: 'text-amber-700',  label: 'Short' },
  incomplete: { bg: 'bg-amber-50',  text: 'text-amber-700',  label: 'Incomplete picture' },
  unknown:    { bg: 'bg-slate-100', text: 'text-slate-600',  label: 'Not yet reportable' },
}

const today = () => new Date().toISOString().slice(0, 10)
const fmt = d => d ? new Date(d).toLocaleDateString('en-AU', { day: '2-digit', month: 'short' }) : null

export default function ProjectCoverage({ project, readOnly = false }) {
  const [rows, setRows]       = useState([])
  const [history, setHistory] = useState({})     // need_id -> checks[]
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState(null)
  const [check, setCheck]     = useState(null)
  const [saving, setSaving]   = useState(false)
  const [showAll, setShowAll] = useState(false)

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (project?.id) load() }, [project?.id])

  async function load({ quiet = false } = {}) {
    if (!quiet) setLoading(true)
    const { data: cov, error: e1 } = await supabase.from('training_coverage')
      .select('*').eq('project_id', project.id)
    if (e1) { setError(e1.message); setLoading(false); return }

    // History drives the movement arrow. Two answers is the minimum that
    // distinguishes "stalled at 70%" from "reached 70% this fortnight".
    const ids = (cov ?? []).map(r => r.need_id)
    let byNeed = {}
    if (ids.length) {
      const { data: checks } = await supabase.from('training_checks')
        .select('need_id, as_at, trained').in('need_id', ids).order('as_at')
      for (const c of checks ?? []) (byNeed[c.need_id] ??= []).push(c)
    }
    setRows(cov ?? []); setHistory(byNeed); setLoading(false)
  }

  async function saveCheck() {
    setSaving(true); setError(null)
    const payload = {
      need_id: check.need_id,
      as_at: check.as_at,
      // Blank stays NULL: "asked, not answered". Number('') would be 0, which claims
      // the leader answered and said nobody is trained — the opposite meaning.
      trained: check.trained === '' ? null : Number(check.trained),
      reported_by_name: check.reported_by_name?.trim() || null,
      note: check.note?.trim() || null,
    }
    // Re-reporting the same date corrects it rather than appending a second truth.
    const { error: err } = await supabase.from('training_checks')
      .upsert(payload, { onConflict: 'need_id,as_at' })
    setSaving(false)
    if (err) { setError(err.message); return }
    setCheck(null); load({ quiet: true })
  }

  if (loading) return <div className="h-48 bg-slate-100 rounded-2xl animate-pulse" />

  const asOf    = today()
  const summary = summariseCoverage(rows, { asOf })
  const verdict = coverageVerdict(summary)
  const vs      = VERDICT_STYLE[verdict.verdict]

  // Mandatory first, then the rows that need attention, then the rest. Recommended
  // needs are hidden by default — they never block a gate and would dilute the list.
  const visible = rows
    .filter(r => showAll || r.necessity === 'mandatory')
    .sort((a, b) => (a.audience_name === b.audience_name
      ? a.module_name.localeCompare(b.module_name)
      : a.audience_name.localeCompare(b.audience_name)))

  const openCheck = r => {
    if (readOnly) return
    setCheck({
      need_id: r.need_id, audience: r.audience_name, module: r.module_name,
      needed: r.people_needed, owner: r.audience_owner,
      as_at: today(),
      trained: r.trained ?? '',
      reported_by_name: r.audience_owner ?? '',
      note: '',
      moduleStatus: r.module_status,
    })
  }

  return (
    <div>
      <p className="text-xs text-slate-500 max-w-2xl mb-4">
        Each group’s leader reports how many of their people are through each module.
        Nobody is named — a count and a date is the record.
      </p>

      {error && <div className="mb-3 text-[12px] text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">{error}</div>}

      {rows.length === 0 ? (
        <div className="text-center py-10 bg-slate-50 rounded-2xl border border-slate-100">
          <p className="text-slate-400 text-sm">No training needs yet.</p>
          <p className="text-slate-300 text-xs mt-1">Build the needs matrix first — coverage is reported against it.</p>
        </div>
      ) : (
        <>
          {/* ── Headline ─────────────────────────────────────────────────── */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
            <div className="bg-slate-50 rounded-xl p-3">
              <p className="text-[10px] text-slate-400 uppercase tracking-widest">Mandatory coverage</p>
              {/* NULL, not 0%. A programme that has asked nobody is not a programme
                  at zero — those are opposite situations that look identical as a bar. */}
              <p className="text-xl font-semibold text-slate-800">
                {summary.pct == null ? <span className="text-slate-400">—</span> : `${summary.pct}%`}
              </p>
              <p className="text-[10px] text-slate-400 mt-0.5">
                {summary.pct == null ? 'nothing reportable yet' : `${summary.trained} of ${summary.needed} places`}
              </p>
            </div>
            <div className={`rounded-xl p-3 ${vs.bg}`}>
              <p className="text-[10px] text-slate-400 uppercase tracking-widest">Gate view</p>
              <p className={`text-sm font-semibold mt-1 ${vs.text}`}>{vs.label}</p>
              {/* An incomplete picture never reads as a pass, however high the number. */}
              <p className="text-[10px] text-slate-500 mt-0.5">{verdict.why}</p>
            </div>
            <div className="bg-slate-50 rounded-xl p-3">
              <p className="text-[10px] text-slate-400 uppercase tracking-widest">Not reported</p>
              <p className={`text-xl font-semibold ${summary.total - summary.countable ? 'text-amber-600' : 'text-slate-800'}`}>
                {summary.total - summary.countable}
              </p>
              <p className="text-[10px] text-slate-400 mt-0.5">of {summary.total} mandatory needs</p>
            </div>
            <div className="bg-slate-50 rounded-xl p-3">
              <p className="text-[10px] text-slate-400 uppercase tracking-widest">Stale</p>
              <p className={`text-xl font-semibold ${summary.stale.length ? 'text-amber-600' : 'text-slate-800'}`}>
                {summary.stale.length}
              </p>
              {/* An old number quoted at a gate is worse than no number. */}
              <p className="text-[10px] text-slate-400 mt-0.5">not checked in 3 weeks</p>
            </div>
          </div>

          {/* Blocked modules are called out separately: a leader cannot train people
              on material that does not exist yet, so this is not their gap. */}
          {summary.blocked.length > 0 && (
            <div className="mb-4 bg-amber-50 border border-amber-100 rounded-xl px-4 py-3">
              <p className="text-[11px] font-semibold text-amber-800">
                {summary.blocked.length} need{summary.blocked.length === 1 ? '' : 's'} blocked on material, not on leaders
              </p>
              <p className="text-[11px] text-amber-700 mt-0.5">
                {summary.blocked.map(b => `${b.audience} · ${b.module} (${MODULE_STATUS_LABEL[b.status] ?? b.status})`).join(' · ')}
              </p>
            </div>
          )}

          <div className="flex items-center justify-between mb-2">
            <p className="text-[10px] text-slate-400 uppercase tracking-widest">By group and module</p>
            <button onClick={() => setShowAll(v => !v)} className="text-[11px] text-[#1F4E79] hover:underline">
              {showAll ? 'Mandatory only' : 'Include recommended'}
            </button>
          </div>

          {/* ── Rows ─────────────────────────────────────────────────────── */}
          <div className="bg-white border border-slate-100 rounded-2xl divide-y divide-slate-50">
            {visible.map(r => {
              const trend = coverageTrend(history[r.need_id])
              const stale = isStale(r.last_checked, asOf)
              const days  = daysBetween(r.last_checked, asOf)
              return (
                <div key={r.need_id} className="flex items-center gap-3 px-4 py-3 group">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-slate-800 truncate">
                      {r.audience_name}
                      <span className="text-slate-400 font-normal"> · {r.module_name}</span>
                      {r.necessity === 'recommended' && <span className="text-[10px] text-slate-400 ml-1">(rec.)</span>}
                    </p>
                    <p className="text-[11px] text-slate-400">
                      {r.audience_owner ?? <span className="text-amber-600">no owner — nobody to ask</span>}
                      {r.last_checked && <> · asked {fmt(r.last_checked)}</>}
                      {stale && <span className="text-amber-600"> · {days}d ago</span>}
                    </p>
                  </div>

                  {/* The bar only renders when there is a real percentage. Everything
                      else states its reason instead of drawing an empty bar, which
                      would read as zero progress. */}
                  <div className="w-40 shrink-0 hidden sm:block">
                    {r.pct == null ? (
                      <p className="text-[11px] text-amber-600 text-right">
                        {GAP_REASON_LABEL[r.gap_reason] ?? '—'}
                      </p>
                    ) : (
                      <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                        <div className="h-full rounded-full transition-all"
                          style={{ width: `${r.pct}%`,
                                   background: r.pct >= 95 ? '#16A34A' : r.pct >= 60 ? '#E8913A' : '#DC2626' }} />
                      </div>
                    )}
                  </div>

                  <div className="w-24 text-right shrink-0">
                    {r.pct == null
                      ? <span className="text-sm text-slate-300">—</span>
                      : <span className="text-sm font-semibold text-slate-800">{r.pct}%</span>}
                    <p className="text-[10px] text-slate-400">
                      {r.trained == null || r.people_needed == null
                        ? (r.people_needed == null ? 'size unknown' : 'no answer')
                        : `${r.trained} of ${r.people_needed}`}
                    </p>
                  </div>

                  {/* Movement, not just position. "Flat" is stated rather than left
                      blank — coverage that has not moved in a fortnight is a finding. */}
                  <div className="w-16 text-right shrink-0 text-[11px]">
                    {!trend ? <span className="text-slate-300">—</span>
                      : trend.direction === 'up'   ? <span className="text-green-600">▲ {trend.delta}</span>
                      : trend.direction === 'down' ? <span className="text-red-600">▼ {Math.abs(trend.delta)}</span>
                      : <span className="text-amber-600">flat</span>}
                  </div>

                  {!readOnly && (
                    <button onClick={() => openCheck(r)}
                      className="text-[11px] text-[#1F4E79] hover:underline shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                      Record
                    </button>
                  )}
                </div>
              )
            })}
          </div>
        </>
      )}

      {/* ── Record a check ───────────────────────────────────────────────── */}
      {check && (
        <>
          <div className="fixed inset-0 bg-black/40 z-40" onClick={() => setCheck(null)} />
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 pointer-events-none">
            <div className="bg-white rounded-2xl shadow-2xl pointer-events-auto w-full max-w-sm">
              <div className="px-6 py-5 border-b border-slate-100">
                <h3 className="font-bold text-slate-800 text-sm">{check.audience}</h3>
                <p className="text-xs text-slate-500 mt-0.5">{check.module}</p>
              </div>
              <div className="px-6 py-5 space-y-4">
                {check.moduleStatus && check.moduleStatus !== 'ready' && (
                  <div className="text-[11px] text-amber-700 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2">
                    This module is {MODULE_STATUS_LABEL[check.moduleStatus]?.toLowerCase()}. A low number here
                    reflects the material, not the leader.
                  </div>
                )}
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">As at</label>
                  <input type="date" value={check.as_at} onChange={e => setCheck({ ...check, as_at: e.target.value })}
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#1F4E79]" />
                  <p className="text-[10px] text-slate-400 mt-1">The date being reported on, not today’s date.</p>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">
                    How many are through{check.needed != null && ` — of ${check.needed}`}
                  </label>
                  <input type="number" min="0" max={check.needed ?? undefined} value={check.trained}
                    onChange={e => setCheck({ ...check, trained: e.target.value })}
                    placeholder="leave blank if not known yet"
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#1F4E79]" />
                  <p className="text-[10px] text-slate-400 mt-1">
                    Blank means “asked, don’t know yet”. Enter 0 only if the answer really is nobody —
                    the two are reported differently.
                  </p>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">Reported by</label>
                  <input value={check.reported_by_name} onChange={e => setCheck({ ...check, reported_by_name: e.target.value })}
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#1F4E79]" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">Note</label>
                  <input value={check.note} onChange={e => setCheck({ ...check, note: e.target.value })}
                    placeholder="Anything holding it up?"
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#1F4E79]" />
                </div>
              </div>
              <div className="px-6 py-4 border-t border-slate-100 flex justify-end gap-3">
                <button onClick={() => setCheck(null)} className="text-sm text-slate-500 px-4 py-2">Cancel</button>
                <button onClick={saveCheck} disabled={saving || !check.as_at}
                  className="bg-[#1F4E79] text-white text-sm font-semibold px-6 py-2 rounded-lg hover:bg-[#163a5c] transition-colors disabled:opacity-60">
                  {saving ? 'Saving…' : 'Record'}
                </button>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
