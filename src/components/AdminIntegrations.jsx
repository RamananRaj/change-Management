import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'

// ChangeFlow — External Integrations (Master Admin only)
// ============================================================================
// Connect a client's Jira and point a query at whatever they use to mark
// change-relevant work. The platform captures whatever the query returns — it
// never dictates how the client tags their issues.
//
// The API token is write-only from here: the form posts it to the leads/config
// table, but reads come from the `client_integrations_safe` VIEW, which never
// includes the token. All Jira calls (test, fetch) run in the `jira` edge
// function with the service role. The browser never sees the credential again.

const DEFAULT_JQL = 'labels = "Change Management" ORDER BY updated DESC'

const EMPTY = { base_url: '', auth_email: '', api_token: '', jql: DEFAULT_JQL, enabled: false }

const CAT = { 'new':'#64748B', 'indeterminate':'#E8913A', 'done':'#10B981' } // statusCategory → colour

export default function AdminIntegrations() {
  const [clients, setClients]   = useState([])
  const [rows, setRows]         = useState([])       // from the safe view
  const [clientId, setClientId] = useState('')
  const [form, setForm]         = useState(EMPTY)
  const [existing, setExisting] = useState(null)     // safe-view row for the selected client
  const [note, setNote]         = useState(null)     // { type, text }
  const [busy, setBusy]         = useState(false)
  const [testing, setTesting]   = useState(false)
  const [defects, setDefects]   = useState(null)     // fetch result
  const [loadingDefects, setLoadingDefects] = useState(false)

  useEffect(() => { load() }, [])

  async function load() {
    const [{ data: cls }, { data: integ }] = await Promise.all([
      supabase.from('clients').select('id, name').order('name'),
      supabase.from('client_integrations_safe').select('*').eq('provider', 'jira'),
    ])
    setClients(cls ?? [])
    setRows(integ ?? [])
  }

  // When a client is picked, prefill from its safe-view row (never the token).
  function pickClient(id) {
    setClientId(id); setDefects(null); setNote(null)
    const row = rows.find(r => r.client_id === id) ?? null
    setExisting(row)
    setForm(row
      ? { base_url: row.base_url ?? '', auth_email: row.auth_email ?? '', api_token: '', jql: row.jql ?? DEFAULT_JQL, enabled: !!row.enabled }
      : { ...EMPTY })
  }

  async function save() {
    if (!clientId) { setNote({ type:'err', text:'Pick a client first.' }); return }
    if (!form.base_url.trim() || !form.auth_email.trim()) {
      setNote({ type:'err', text:'Base URL and account email are required.' }); return
    }
    setBusy(true); setNote(null)
    // Build the payload. Only send the token if the admin typed one — leaving it
    // blank on an existing connection keeps the stored token untouched.
    const payload = {
      client_id: clientId, provider: 'jira',
      base_url: form.base_url.trim(), auth_email: form.auth_email.trim(),
      jql: form.jql.trim() || DEFAULT_JQL, enabled: form.enabled,
    }
    if (form.api_token.trim()) payload.api_token = form.api_token.trim()

    // Upsert on (client_id, provider).
    const { error } = await supabase.from('client_integrations')
      .upsert(payload, { onConflict: 'client_id,provider' })
    setBusy(false)
    if (error) { setNote({ type:'err', text: error.message }); return }
    setForm(f => ({ ...f, api_token: '' }))   // never keep the token in the form
    setNote({ type:'ok', text:'Saved. Test the connection to confirm it works.' })
    await load()
    // refresh the "existing" pointer
    const { data } = await supabase.from('client_integrations_safe').select('*').eq('client_id', clientId).eq('provider','jira').single()
    setExisting(data ?? null)
  }

  async function testConnection() {
    if (!clientId) return
    setTesting(true); setNote(null)
    const { data, error } = await supabase.functions.invoke('jira', { body: { action:'test', client_id: clientId } })
    setTesting(false)
    if (error) { setNote({ type:'err', text:'Test failed to run — is the jira function deployed?' }); return }
    setNote({ type: data?.ok ? 'ok' : 'err', text: data?.note ?? (data?.error ?? 'Unknown result') })
    await load()
    const { data: row } = await supabase.from('client_integrations_safe').select('*').eq('client_id', clientId).eq('provider','jira').single()
    setExisting(row ?? null)
  }

  async function fetchDefects() {
    if (!clientId) return
    setLoadingDefects(true); setDefects(null); setNote(null)
    const { data, error } = await supabase.functions.invoke('jira', { body: { action:'fetch', client_id: clientId } })
    setLoadingDefects(false)
    if (error || data?.error) { setNote({ type:'err', text: data?.error ?? 'Fetch failed.' }); return }
    setDefects(data)
  }

  const configuredClients = useMemo(() =>
    new Set(rows.map(r => r.client_id)), [rows])

  return (
    <div>
      <div className="bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 mb-5">
        <p className="text-[13px] text-slate-600 leading-relaxed">
          <strong className="text-[#1F4E79]">Bring change-relevant issues in from Jira.</strong>{' '}
          Connect a client's Jira, then point a query at whatever they use to flag change work —
          a label, a project, an issue type, a saved filter. CORA reads what the query returns to
          understand impact. The default catches anything labelled <code className="bg-white px-1 rounded border border-slate-200">Change Management</code>.
        </p>
      </div>

      {/* Client picker */}
      <div className="flex flex-wrap items-center gap-3 mb-5">
        <label className="text-sm font-semibold text-slate-600">Client</label>
        <select value={clientId} onChange={e => pickClient(e.target.value)}
          className="border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:border-[#1F4E79] min-w-[240px]">
          <option value="">Select a client…</option>
          {clients.map(c => (
            <option key={c.id} value={c.id}>{c.name}{configuredClients.has(c.id) ? '  · connected' : ''}</option>
          ))}
        </select>
      </div>

      {note && (
        <div className={`rounded-lg px-4 py-2.5 mb-4 text-sm ${note.type === 'err' ? 'bg-red-50 text-red-700 border border-red-200' : 'bg-green-50 text-green-700 border border-green-200'}`}>
          {note.text}
        </div>
      )}

      {clientId && (
        <div className="grid md:grid-cols-2 gap-6">
          {/* ── Config form ── */}
          <div className="bg-white border border-slate-200 rounded-xl p-5">
            <h3 className="text-base font-bold text-[#1F4E79] mb-4">Jira connection</h3>
            <div className="space-y-3.5">
              <label className="block">
                <span className="text-[11px] font-semibold text-slate-600">Jira base URL *</span>
                <input value={form.base_url} onChange={e => setForm(f => ({ ...f, base_url: e.target.value }))}
                  placeholder="https://your-company.atlassian.net"
                  className="w-full mt-1 border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#1F4E79]" />
              </label>
              <label className="block">
                <span className="text-[11px] font-semibold text-slate-600">Account email *</span>
                <input value={form.auth_email} onChange={e => setForm(f => ({ ...f, auth_email: e.target.value }))}
                  placeholder="you@company.com" autoComplete="off"
                  className="w-full mt-1 border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#1F4E79]" />
              </label>
              <label className="block">
                <span className="text-[11px] font-semibold text-slate-600">
                  API token {existing?.has_token ? <span className="text-green-600 font-normal">· stored (leave blank to keep)</span> : '*'}
                </span>
                <input type="password" value={form.api_token} onChange={e => setForm(f => ({ ...f, api_token: e.target.value }))}
                  placeholder={existing?.has_token ? '•••••••• (unchanged)' : 'Paste your Jira API token'} autoComplete="new-password"
                  className="w-full mt-1 border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#1F4E79]" />
                <span className="block text-[11px] text-slate-400 mt-1">Stored server-side. It is never shown again or sent back to the browser.</span>
              </label>
              <label className="block">
                <span className="text-[11px] font-semibold text-slate-600">Which issues? (JQL)</span>
                <textarea value={form.jql} onChange={e => setForm(f => ({ ...f, jql: e.target.value }))} rows={2}
                  className="w-full mt-1 border border-slate-200 rounded-lg px-3 py-2 text-xs font-mono focus:outline-none focus:border-[#1F4E79]" />
                <span className="block text-[11px] text-slate-400 mt-1">Any valid JQL. Every Jira is different — change this to match how the client tags change work.</span>
              </label>
              <label className="flex items-center gap-2.5 pt-1">
                <input type="checkbox" checked={form.enabled} onChange={e => setForm(f => ({ ...f, enabled: e.target.checked }))}
                  className="w-4 h-4 accent-[#1F4E79]" />
                <span className="text-[13px] text-slate-700">Enabled — allow CORA to pull these issues</span>
              </label>
            </div>
            <div className="flex flex-wrap gap-2 mt-5">
              <button onClick={save} disabled={busy}
                className="bg-[#1F4E79] text-white text-sm font-semibold px-4 py-2 rounded-lg hover:bg-[#17395a] disabled:opacity-60">
                {busy ? 'Saving…' : 'Save connection'}
              </button>
              <button onClick={testConnection} disabled={testing || !existing}
                className="border border-slate-200 text-slate-700 text-sm font-semibold px-4 py-2 rounded-lg hover:bg-slate-50 disabled:opacity-50">
                {testing ? 'Testing…' : 'Test connection'}
              </button>
            </div>
            {existing?.last_tested_at && (
              <p className={`text-[12px] mt-3 font-medium ${existing.last_test_ok ? 'text-green-600' : 'text-red-500'}`}>
                {existing.last_test_ok ? '✓ ' : '✗ '}{existing.last_test_note}
              </p>
            )}
          </div>

          {/* ── Setup steps ── */}
          <div className="bg-white border border-slate-200 rounded-xl p-5">
            <h3 className="text-base font-bold text-[#1F4E79] mb-4">Setup steps</h3>
            <ol className="space-y-3 text-[13px] text-slate-700">
              {[
                ['Create an API token', <>In Jira, go to <strong>Account settings → Security → API tokens</strong> and create one. Copy it — it is shown once.</>],
                ['Use the token owner’s email', <>The account email above must be the one that created the token. That account’s Jira permissions decide what CORA can see.</>],
                ['Set the base URL', <>Your Jira address, e.g. <code className="bg-slate-50 px-1 rounded">https://acme.atlassian.net</code> — no trailing path.</>],
                ['Point the query', <>Leave the default to catch <code className="bg-slate-50 px-1 rounded">Change Management</code>-labelled issues, or edit the JQL to match this client’s convention.</>],
                ['Save, then Test', <>Save the connection, then Test to confirm the credentials work before enabling.</>],
                ['Enable & preview', <>Turn on <em>Enabled</em>, then preview the issues below to check the query returns what you expect.</>],
              ].map(([h, b], i) => (
                <li key={i} className="flex gap-3">
                  <span className="flex-none w-6 h-6 rounded-full bg-[#1F4E79]/10 text-[#1F4E79] grid place-items-center text-[12px] font-bold">{i + 1}</span>
                  <span><strong className="text-[#1F4E79]">{h}.</strong> {b}</span>
                </li>
              ))}
            </ol>
            <p className="text-[11px] text-slate-400 mt-4 pt-3 border-t border-slate-100">
              Confluence uses the same token. Confluence pull is on the roadmap — the connection here reuses the credential when it lands.
            </p>
          </div>
        </div>
      )}

      {/* ── Defect preview ── */}
      {clientId && existing?.enabled && (
        <div className="mt-6">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-base font-bold text-[#1F4E79]">Change-relevant issues</h3>
            <button onClick={fetchDefects} disabled={loadingDefects}
              className="bg-[#E8913A] text-white text-sm font-semibold px-4 py-2 rounded-lg hover:bg-[#d07e2e] disabled:opacity-60">
              {loadingDefects ? 'Pulling from Jira…' : 'Preview from Jira'}
            </button>
          </div>

          {defects && (
            <>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
                <Stat label="Matched" v={defects.total} />
                <Stat label="Still open" v={defects.open} c="text-amber-600" />
                <Stat label="Statuses" v={Object.keys(defects.byStatus ?? {}).length} />
                <Stat label="Priorities" v={Object.keys(defects.byPriority ?? {}).length} />
              </div>
              {defects.issues?.length ? (
                <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
                  <table className="w-full text-sm">
                    <thead className="bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500">
                      <tr>
                        <th className="text-left font-semibold px-4 py-2.5">Key</th>
                        <th className="text-left font-semibold px-4 py-2.5">Summary</th>
                        <th className="text-left font-semibold px-4 py-2.5">Type</th>
                        <th className="text-left font-semibold px-4 py-2.5">Priority</th>
                        <th className="text-left font-semibold px-4 py-2.5">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {defects.issues.map(it => (
                        <tr key={it.key} className="border-t border-slate-100">
                          <td className="px-4 py-2.5 font-mono text-[12px] text-[#1F4E79]">
                            {it.url ? <a href={it.url} target="_blank" rel="noreferrer" className="hover:underline">{it.key}</a> : it.key}
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
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="text-center py-10 bg-slate-50 rounded-xl border border-slate-200 text-slate-400 text-sm">
                  The query returned no issues. Check the JQL matches how this client tags change work.
                </div>
              )}
            </>
          )}
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
