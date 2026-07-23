import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'

// ChangeFlow — Risks / Issues (per client)
// ============================================================================
// The change-relevant issues for THIS client, pulled live from their connected
// Jira. This is where the issues live — the connection itself is configured once
// under System Admin → External Integrations. Setup and data are deliberately
// separate: one place to wire a tool up, this place to work the issues it feeds.
//
// Reads via the `jira` edge function (fetch), which holds the token server-side.
// If no Jira is connected for the client, this points back to the setup place
// rather than showing an empty table with no explanation.

const CAT = { 'new': '#64748B', 'indeterminate': '#E8913A', 'done': '#10B981' }

export default function ClientRisks({ clientId, clientName }) {
  const [state, setState] = useState('idle')   // idle | loading | ok | none | error
  const [data, setData]   = useState(null)
  const [msg, setMsg]     = useState('')
  const [filter, setFilter] = useState('open') // open | done | all | <exact status>

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (clientId) load() }, [clientId])

  // Filter the pulled issues client-side — no re-fetch, instant. 'open' = anything
  // not in the 'done' status category; 'done' = completed; or an exact status name.
  const shown = useMemo(() => {
    const all = data?.issues ?? []
    if (filter === 'all')  return all
    if (filter === 'open') return all.filter(i => i.statusCategory !== 'done')
    if (filter === 'done') return all.filter(i => i.statusCategory === 'done')
    return all.filter(i => i.status === filter)
  }, [data, filter])

  async function load() {
    setState('loading'); setData(null); setMsg('')
    const { data: res, error } = await supabase.functions.invoke('jira', { body: { action: 'fetch', client_id: clientId } })
    if (error) {
      // A 4xx from the function arrives as a FunctionsHttpError; read the body for the reason.
      let reason = ''
      try { reason = (await error.context?.json?.())?.error ?? '' } catch { /* fall through */ }
      if (/no integration|turned off/i.test(reason)) { setState('none'); setMsg(reason); return }
      setState('error'); setMsg(reason || 'Could not reach Jira.'); return
    }
    if (res?.error) {
      if (/no integration|turned off/i.test(res.error)) { setState('none'); setMsg(res.error); return }
      setState('error'); setMsg(res.error); return
    }
    setData(res); setState('ok')
  }

  if (state === 'loading')
    return <div className="text-center py-14 text-slate-400 text-sm">Pulling issues from Jira…</div>

  if (state === 'none')
    return (
      <div className="text-center py-12 bg-slate-50 rounded-xl border border-slate-200">
        <div className="text-3xl mb-3">🔌</div>
        <p className="text-slate-600 font-semibold mb-1">No issue source connected for {clientName}.</p>
        <p className="text-slate-400 text-sm max-w-md mx-auto">
          Connect this client's Jira under <strong>System Admin → External Integrations</strong>,
          then their change-relevant issues appear here.
        </p>
      </div>
    )

  if (state === 'error')
    return (
      <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-700">
        {msg} <button onClick={load} className="underline font-semibold ml-1">Retry</button>
      </div>
    )

  if (state !== 'ok' || !data) return null

  return (
    <div className="pb-24">
      <div className="flex items-center justify-between mb-4">
        <div>
          <p className="text-[13px] text-slate-500">Change-relevant issues from {clientName}'s Jira, live.</p>
          <p className="text-[11px] text-slate-400 mt-0.5 font-mono">{data.jql}</p>
        </div>
        <button onClick={load} className="text-[13px] font-semibold text-[#1F4E79] border border-slate-200 rounded-lg px-3 py-1.5 hover:bg-slate-50">
          Refresh
        </button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        <Stat label="Matched" v={data.total} />
        <Stat label="Still open" v={data.open} c={data.open ? 'text-amber-600' : 'text-slate-400'} />
        <Stat label="Statuses" v={Object.keys(data.byStatus ?? {}).length} />
        <Stat label="Priorities" v={Object.keys(data.byPriority ?? {}).length} />
      </div>

      {/* Filter — Open / Done / All, plus a chip per exact status returned. Filters the
          already-pulled list, so switching is instant and costs no Jira call. */}
      {data.issues?.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-4">
          {[['open', `Open (${(data.issues ?? []).filter(i => i.statusCategory !== 'done').length})`],
            ['done', `Done (${(data.issues ?? []).filter(i => i.statusCategory === 'done').length})`],
            ['all',  `All (${data.total})`]].map(([k, label]) => (
            <Chip key={k} active={filter === k} onClick={() => setFilter(k)}>{label}</Chip>
          ))}
          <span className="w-px bg-slate-200 mx-1 self-stretch" />
          {Object.entries(data.byStatus ?? {}).map(([st, n]) => (
            <Chip key={st} active={filter === st} onClick={() => setFilter(st)} subtle>{st} · {n}</Chip>
          ))}
        </div>
      )}

      {data.issues?.length ? (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500">
              <tr>
                <th className="text-left font-semibold px-4 py-2.5">Key</th>
                <th className="text-left font-semibold px-4 py-2.5">Summary</th>
                <th className="text-left font-semibold px-4 py-2.5">Type</th>
                <th className="text-left font-semibold px-4 py-2.5">Priority</th>
                <th className="text-left font-semibold px-4 py-2.5">Status</th>
                <th className="text-right font-semibold px-4 py-2.5">Link</th>
              </tr>
            </thead>
            <tbody>
              {shown.length === 0 && (
                <tr><td colSpan={6} className="px-4 py-8 text-center text-slate-400 text-[13px]">No issues match this filter.</td></tr>
              )}
              {shown.map(it => (
                <tr key={it.key} className="border-t border-slate-100 hover:bg-slate-50/60">
                  <td className="px-4 py-2.5">
                    {it.url
                      ? <a href={it.url} target="_blank" rel="noreferrer" className="inline-block font-mono text-[12px] font-semibold text-[#0052CC] bg-[#0052CC]/8 px-2 py-0.5 rounded hover:bg-[#0052CC]/15">{it.key}</a>
                      : <span className="font-mono text-[12px] text-slate-500">{it.key}</span>}
                  </td>
                  <td className="px-4 py-2.5 text-[13px] text-slate-700 max-w-md truncate">{it.summary}</td>
                  <td className="px-4 py-2.5 text-[12px] text-slate-500">{it.type ?? '—'}</td>
                  <td className="px-4 py-2.5 text-[12px] text-slate-500">{it.priority ?? '—'}</td>
                  <td className="px-4 py-2.5">
                    <span className="inline-flex items-center gap-1.5 text-[12px] text-slate-600">
                      <span className="w-2 h-2 rounded-full" style={{ background: CAT[it.statusCategory] ?? '#94A3B8' }} />
                      {it.status ?? '—'}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    {it.url ? (
                      <a href={it.url} target="_blank" rel="noreferrer" title="Open in Jira (new tab)"
                         className="inline-grid place-items-center w-7 h-7 rounded-lg text-[#0052CC] hover:bg-[#0052CC]/10 transition-colors">
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none">
                          <path d="M7 17 17 7M8 7h9v9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                        </svg>
                      </a>
                    ) : <span className="text-slate-300">—</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="text-center py-10 bg-slate-50 rounded-xl border border-slate-200 text-slate-400 text-sm">
          The query returned no issues. Adjust the JQL in External Integrations to match how {clientName} tags change work.
        </div>
      )}
    </div>
  )
}

function Stat({ label, v, c = 'text-[#1F4E79]' }) {
  return (
    <div className="bg-white border border-slate-200 rounded-xl px-4 py-3">
      <div className={`text-2xl font-bold ${c}`}>{v}</div>
      <div className="text-[11px] text-slate-500 mt-0.5">{label}</div>
    </div>
  )
}

function Chip({ active, onClick, children, subtle }) {
  return (
    <button onClick={onClick}
      className={`text-[12.5px] font-semibold px-3 py-1.5 rounded-full border transition-colors ${
        active
          ? 'bg-[#1F4E79] text-white border-[#1F4E79]'
          : subtle
            ? 'bg-white text-slate-500 border-slate-200 hover:border-slate-300'
            : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'}`}>
      {children}
    </button>
  )
}
