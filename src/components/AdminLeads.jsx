import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { leadBucket, leadStaleness, canConvertLead, summariseLeads } from '../lib/ai/analysis'

// ChangeFlow — Leads & Opportunities (Master Admin only)
// ============================================================================
// The pipeline in front of a client. A lead arrives from the marketing site's
// "Book a demo" form, or is added here by hand after a conversation. Flipping one
// toggle promotes it to an Opportunity; converting it creates the client, its first
// project and the invite link in a single action, so a won lead lands the person
// straight into the product.
//
// VISIBILITY: this is Master Admin only, and that is enforced by RLS on public.leads
// (`USING (public.is_admin())`, with no client-admin policy at all). The tab being
// absent for other roles is convenience — the database is what actually stops them.
//
// Reads the `lead_pipeline` view (which derives bucket, age and overdue) but writes
// to the `leads` table. Same split as the comms plan: derived on the way out, plain
// on the way in.

const BUCKETS = ['Leads', 'Opportunities', 'Closed']

const SOURCES = [
  { v: 'website',  l: 'Website form' },
  { v: 'manual',   l: 'Added by hand' },
  { v: 'referral', l: 'Referral' },
  { v: 'event',    l: 'Event / chapter' },
  { v: 'linkedin', l: 'LinkedIn' },
  { v: 'partner',  l: 'Partner' },
  { v: 'other',    l: 'Other' },
]
const sourceLabel = v => SOURCES.find(s => s.v === v)?.l ?? v

const EMPTY_LEAD = {
  full_name: '', email: '', organisation: '', role: '', phone: '',
  programme_size: '', timeframe: '', message: '', source: 'manual', source_detail: '',
}

const todayYmd = () => new Date().toISOString().slice(0, 10)

export default function AdminLeads({ allRoles = [] }) {
  const { user } = useAuth()
  const [rows, setRows]       = useState([])
  const [loading, setLoading] = useState(true)
  const [bucket, setBucket]   = useState('Leads')
  const [search, setSearch]   = useState('')
  const [note, setNote]       = useState(null)      // { type:'ok'|'err', text }
  const [busy, setBusy]       = useState(null)      // lead id being written
  const [expanded, setExpanded] = useState(null)    // lead id whose detail is open
  const [showAdd, setShowAdd] = useState(false)
  const [addForm, setAddForm] = useState(EMPTY_LEAD)
  const [addErr, setAddErr]   = useState(null)
  const [convert, setConvert] = useState(null)      // lead being converted
  const [convForm, setConvForm] = useState({ name: '', industry: '', project: '', role: '', as_client_admin: true })
  const [convErr, setConvErr] = useState(null)
  const [convDone, setConvDone] = useState(null)    // { clientId, token, email }
  const [copied, setCopied]   = useState(false)

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    // The view carries bucket/age/overdue already, but we recompute in JS too so a
    // row edited in place reclassifies without a round trip.
    const { data, error } = await supabase
      .from('lead_pipeline')
      .select('*')
      .order('created_at', { ascending: false })
    if (error) setNote({ type: 'err', text: error.message })
    setRows(data ?? [])
    setLoading(false)
  }

  const today   = todayYmd()
  const summary = useMemo(() => summariseLeads(rows, { today }), [rows, today])

  const visible = useMemo(() => {
    const want = bucket === 'Leads' ? 'lead' : bucket === 'Opportunities' ? 'opportunity' : 'closed'
    const q = search.trim().toLowerCase()
    return rows.filter(r => {
      if (leadBucket(r) !== want) return false
      if (!q) return true
      return [r.full_name, r.email, r.organisation, r.role].some(v => (v ?? '').toLowerCase().includes(q))
    })
  }, [rows, bucket, search])

  const countOf = b => rows.filter(r => leadBucket(r) === (b === 'Leads' ? 'lead' : b === 'Opportunities' ? 'opportunity' : 'closed')).length

  // ── writes ────────────────────────────────────────────────────────────────
  async function patch(id, changes) {
    setBusy(id); setNote(null)
    const { error } = await supabase.from('leads').update(changes).eq('id', id)
    setBusy(null)
    if (error) { setNote({ type: 'err', text: error.message }); return false }
    await load()
    return true
  }

  const togglePromote = r => patch(r.id, { is_opportunity: !r.is_opportunity })
  const claim         = r => patch(r.id, { owner_id: r.owner_id ? null : user.id })
  const logContact    = r => patch(r.id, { last_contacted: new Date().toISOString() })

  async function markLost(r) {
    const why = window.prompt('Why is this lost? (optional, but future-you will want it)')
    if (why === null) return                        // cancelled
    await patch(r.id, { status: 'lost', lost_reason: why.trim() || null })
  }
  const reopen = r => patch(r.id, { status: 'open', lost_reason: null })

  async function addLead() {
    const f = addForm
    if (!f.full_name.trim()) { setAddErr('Enter a name.'); return }
    if (!f.email.trim())     { setAddErr('Enter an email address.'); return }
    setAddErr(null); setBusy('new')
    const { error } = await supabase.from('leads').insert({
      ...Object.fromEntries(Object.entries(f).map(([k, v]) => [k, (v ?? '').trim() || null])),
      full_name: f.full_name.trim(),
      email: f.email.trim(),
      source: f.source || 'manual',
      owner_id: user.id,                            // you added it, you own it
    })
    setBusy(null)
    if (error) { setAddErr(error.message); return }
    setAddForm(EMPTY_LEAD); setShowAdd(false)
    await load()
  }

  // ── conversion: client + first project + invite, in one go ────────────────
  function openConvert(r) {
    setConvert(r)
    setConvErr(null); setConvDone(null)
    setConvForm({
      name:     r.organisation ?? '',
      industry: '',
      project:  'Change programme',
      role:     '',
      as_client_admin: true,
    })
  }

  async function doConvert() {
    const r = convert
    const guard = canConvertLead(r)
    if (!guard.ok) { setConvErr(guard.reasons.join(' ')); return }
    if (!convForm.name.trim())    { setConvErr('The client needs a name.'); return }
    if (!convForm.project.trim()) { setConvErr('Name the first project.'); return }
    if (!convForm.role)           { setConvErr('Choose an Access Persona — it decides what content they see.'); return }

    setConvErr(null); setBusy(r.id)

    // 1. The client.
    const { data: client, error: cErr } = await supabase.from('clients').insert({
      name:          convForm.name.trim(),
      industry:      convForm.industry.trim() || null,
      contact_name:  r.full_name,
      contact_email: r.email,
      notes:         `Converted from lead ${r.id} (${sourceLabel(r.source)}).`,
    }).select('id').single()
    if (cErr || !client) { setBusy(null); setConvErr(cErr?.message ?? 'Could not create the client.'); return }

    // 2. The first project, with its lane and phases — mirroring what AdminClients
    //    does on creation. Phases must carry a lane_id or the programme lands with
    //    nothing in scope and every percentage reads zero.
    const { data: project, error: pErr } = await supabase.from('projects').insert({
      client_id: client.id, name: convForm.project.trim(), status: 'planning',
    }).select('id').single()
    if (pErr || !project) { setBusy(null); setConvErr(`Client created, but the project failed: ${pErr?.message}`); return }

    const { data: lane } = await supabase.from('project_lanes')
      .insert({ project_id: project.id, name: 'Change programme', tint: '#eff6ff', sort_order: 0 })
      .select('id').single()
    await supabase.from('project_phases').insert(
      [1, 2, 3, 4, 5].map(ph => ({
        project_id: project.id, phase_number: ph, status: 'locked', lane_id: lane?.id ?? null,
      }))
    )

    // 3. The invite — same shape AdminClients uses, so one signup flow serves both.
    const { data: invite, error: iErr } = await supabase.from('project_invites').insert({
      project_id: project.id,
      client_id:  client.id,
      email:      r.email,
      full_name:  r.full_name,
      role:       convForm.role,
      as_client_admin: !!convForm.as_client_admin,
      invited_by: user.id,
    }).select('token').single()
    if (iErr) { setBusy(null); setConvErr(`Client and project created, but the invite failed: ${iErr.message}`); return }

    // 4. Close the lead. The won-requires-a-client constraint means this has to
    //    carry the client id — it cannot be marked won on its own.
    await supabase.from('leads').update({
      status: 'won', converted_client_id: client.id, is_opportunity: true,
    }).eq('id', r.id)

    setBusy(null)
    setConvDone({ clientId: client.id, token: invite?.token, email: r.email })
    await load()
  }

  const inviteLink = token => `${window.location.origin}/auth/signup?invite=${token}`
  async function copyInvite(token) {
    try { await navigator.clipboard.writeText(inviteLink(token)); setCopied(true); setTimeout(() => setCopied(false), 1800) }
    catch { /* clipboard blocked — the text is selectable */ }
  }

  // ── render ────────────────────────────────────────────────────────────────
  if (loading) return <div className="text-center py-14 text-slate-400 text-sm">Loading pipeline…</div>

  return (
    <div>
      {/* Summary — the numbers plus what is being neglected */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-5">
        {[
          { l: 'Leads',         v: summary.leads,         c: 'text-[#1F4E79]' },
          { l: 'Opportunities', v: summary.opportunities, c: 'text-[#E8913A]' },
          { l: 'Won',           v: summary.won,           c: 'text-green-600' },
          { l: 'Overdue',       v: summary.overdue,       c: summary.overdue ? 'text-red-500' : 'text-slate-400' },
          { l: 'No contact 14d+', v: summary.stale,       c: summary.stale ? 'text-amber-600' : 'text-slate-400' },
        ].map(s => (
          <div key={s.l} className="bg-white border border-slate-200 rounded-xl px-4 py-3">
            <div className={`text-2xl font-bold ${s.c}`}>{s.v}</div>
            <div className="text-[11px] text-slate-500 mt-0.5">{s.l}</div>
          </div>
        ))}
      </div>

      {summary.gaps.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 mb-5">
          <p className="text-[11px] font-bold text-amber-800 uppercase tracking-wide mb-1.5">Needs attention</p>
          <ul className="text-[13px] text-amber-900 space-y-1">
            {summary.gaps.map((g, i) => <li key={i}>· {g}</li>)}
          </ul>
        </div>
      )}

      {note && (
        <div className={`rounded-lg px-4 py-2.5 mb-4 text-sm ${note.type === 'err' ? 'bg-red-50 text-red-700 border border-red-200' : 'bg-green-50 text-green-700 border border-green-200'}`}>
          {note.text}
        </div>
      )}

      {/* Bucket switch + search + add */}
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <div className="inline-flex bg-slate-100 rounded-lg p-1">
          {BUCKETS.map(b => (
            <button key={b} onClick={() => setBucket(b)}
              className={`px-4 py-1.5 rounded-lg text-sm font-semibold transition-colors ${bucket === b ? 'bg-white text-[#1F4E79] shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>
              {b} <span className="text-slate-400 font-normal">({countOf(b)})</span>
            </button>
          ))}
        </div>
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search name, email, org…"
          className="border border-slate-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:border-[#1F4E79] flex-1 min-w-[200px]" />
        <button onClick={() => { setShowAdd(v => !v); setAddErr(null) }}
          className="bg-[#1F4E79] text-white text-sm font-semibold px-4 py-1.5 rounded-lg hover:bg-[#17395a] transition-colors">
          {showAdd ? 'Cancel' : '+ Add lead'}
        </button>
      </div>

      {/* Add by hand — for the ones that arrive by conversation, not by form */}
      {showAdd && (
        <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 mb-5">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {[
              ['full_name', 'Full name *'], ['email', 'Work email *'], ['organisation', 'Organisation'],
              ['role', 'Their role'], ['phone', 'Phone'], ['source_detail', 'Where from (e.g. ACMP Sydney)'],
            ].map(([k, label]) => (
              <label key={k} className="flex flex-col gap-1">
                <span className="text-[11px] font-semibold text-slate-600">{label}</span>
                <input value={addForm[k]} onChange={e => setAddForm(f => ({ ...f, [k]: e.target.value }))}
                  className="border border-slate-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:border-[#1F4E79]" />
              </label>
            ))}
            <label className="flex flex-col gap-1">
              <span className="text-[11px] font-semibold text-slate-600">Source</span>
              <select value={addForm.source} onChange={e => setAddForm(f => ({ ...f, source: e.target.value }))}
                className="border border-slate-200 rounded-lg px-3 py-1.5 text-sm bg-white focus:outline-none focus:border-[#1F4E79]">
                {SOURCES.filter(s => s.v !== 'website').map(s => <option key={s.v} value={s.v}>{s.l}</option>)}
              </select>
            </label>
            <label className="flex flex-col gap-1 md:col-span-2">
              <span className="text-[11px] font-semibold text-slate-600">What are they trying to change?</span>
              <input value={addForm.message} onChange={e => setAddForm(f => ({ ...f, message: e.target.value }))}
                className="border border-slate-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:border-[#1F4E79]" />
            </label>
          </div>
          {addErr && <p className="text-xs text-red-500 mt-2 font-medium">⚠ {addErr}</p>}
          <button onClick={addLead} disabled={busy === 'new'}
            className="mt-3 bg-[#E8913A] text-white text-sm font-semibold px-4 py-1.5 rounded-lg hover:bg-[#d07e2e] disabled:opacity-60">
            {busy === 'new' ? 'Saving…' : 'Add lead'}
          </button>
        </div>
      )}

      {/* The list */}
      {visible.length === 0 ? (
        <div className="text-center py-14 bg-slate-50 rounded-xl border border-slate-200 text-slate-400 text-sm">
          {search ? 'Nothing matches that search.'
            : bucket === 'Leads' ? 'No open leads. New demo requests from the website land here.'
            : bucket === 'Opportunities' ? 'No opportunities yet. Toggle a lead across when it is worth real time.'
            : 'Nothing closed yet.'}
        </div>
      ) : (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500">
              <tr>
                <th className="text-left font-semibold px-4 py-2.5">Who</th>
                <th className="text-left font-semibold px-4 py-2.5">Source</th>
                <th className="text-left font-semibold px-4 py-2.5">Age</th>
                <th className="text-left font-semibold px-4 py-2.5">Owner</th>
                <th className="text-left font-semibold px-4 py-2.5">Next</th>
                <th className="text-right font-semibold px-4 py-2.5">Actions</th>
              </tr>
            </thead>
            <tbody>
              {visible.map(r => {
                const s = leadStaleness(r, { today })
                const open = expanded === r.id
                return (
                  <tr key={r.id} className="border-t border-slate-100 align-top">
                    <td className="px-4 py-3">
                      <button onClick={() => setExpanded(open ? null : r.id)} className="text-left">
                        <span className="font-semibold text-[#1F4E79]">{r.full_name}</span>
                        <span className="block text-[12px] text-slate-500">{r.organisation || <em className="text-slate-400">no organisation</em>}</span>
                        <span className="block text-[11px] text-slate-400">{r.email}</span>
                      </button>
                      {open && (
                        <div className="mt-3 pt-3 border-t border-dashed border-slate-200 space-y-2 max-w-md">
                          {r.message && <p className="text-[12px] text-slate-600 italic">"{r.message}"</p>}
                          <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-slate-500">
                            {r.role           && <span>Role: {r.role}</span>}
                            {r.programme_size && <span>Size: {r.programme_size}</span>}
                            {r.timeframe      && <span>When: {r.timeframe}</span>}
                            {r.phone          && <span>{r.phone}</span>}
                          </div>
                          <label className="block">
                            <span className="text-[11px] font-semibold text-slate-600">Next action</span>
                            <div className="flex gap-2 mt-1">
                              <input defaultValue={r.next_action ?? ''} placeholder="e.g. Send the Meridian sample"
                                onBlur={e => e.target.value !== (r.next_action ?? '') && patch(r.id, { next_action: e.target.value.trim() || null })}
                                className="flex-1 border border-slate-200 rounded-lg px-2 py-1 text-xs focus:outline-none focus:border-[#1F4E79]" />
                              <input type="date" defaultValue={r.next_action_on ?? ''}
                                onBlur={e => e.target.value !== (r.next_action_on ?? '') && patch(r.id, { next_action_on: e.target.value || null })}
                                className="border border-slate-200 rounded-lg px-2 py-1 text-xs focus:outline-none focus:border-[#1F4E79]" />
                            </div>
                          </label>
                          <label className="block">
                            <span className="text-[11px] font-semibold text-slate-600">Notes</span>
                            <textarea defaultValue={r.notes ?? ''} rows={3}
                              onBlur={e => e.target.value !== (r.notes ?? '') && patch(r.id, { notes: e.target.value.trim() || null })}
                              className="w-full mt-1 border border-slate-200 rounded-lg px-2 py-1 text-xs focus:outline-none focus:border-[#1F4E79]" />
                          </label>
                          {r.lost_reason && <p className="text-[11px] text-red-500">Lost: {r.lost_reason}</p>}
                          {r.converted_client_name && <p className="text-[11px] text-green-600">→ Client: {r.converted_client_name}</p>}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-[12px] text-slate-500">
                      {sourceLabel(r.source)}
                      {r.source_detail && <span className="block text-[11px] text-slate-400">{r.source_detail}</span>}
                    </td>
                    <td className="px-4 py-3 text-[12px]">
                      <span className="text-slate-600">{s.ageDays}d old</span>
                      {r.status === 'open' && s.daysSinceContact >= 14 && (
                        <span className="block text-[11px] text-amber-600 font-semibold">{s.daysSinceContact}d no contact</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-[12px]">
                      {r.owner_id
                        ? <span className="text-slate-600">{r.owner_id === user?.id ? 'You' : 'Assigned'}</span>
                        : <span className="text-amber-600 font-semibold">Unowned</span>}
                    </td>
                    <td className="px-4 py-3 text-[12px]">
                      {r.next_action
                        ? <>
                            <span className="text-slate-600">{r.next_action}</span>
                            {r.next_action_on && (
                              <span className={`block text-[11px] font-semibold ${s.actionOverdue ? 'text-red-500' : 'text-slate-400'}`}>
                                {s.actionOverdue ? 'Overdue · ' : ''}{r.next_action_on}
                              </span>
                            )}
                          </>
                        : <span className="text-slate-400 italic">none set</span>}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-1.5 justify-end">
                        {r.status === 'open' ? (
                          <>
                            <button onClick={() => togglePromote(r)} disabled={busy === r.id}
                              className={`text-[11px] font-semibold px-2.5 py-1 rounded-lg border transition-colors disabled:opacity-60 ${
                                r.is_opportunity ? 'border-slate-200 text-slate-500 hover:bg-slate-50' : 'border-[#E8913A] text-[#E8913A] hover:bg-orange-50'}`}>
                              {r.is_opportunity ? '← Back to lead' : '→ Opportunity'}
                            </button>
                            <button onClick={() => claim(r)} disabled={busy === r.id}
                              className="text-[11px] font-semibold px-2.5 py-1 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 disabled:opacity-60">
                              {r.owner_id === user?.id ? 'Release' : 'Claim'}
                            </button>
                            <button onClick={() => logContact(r)} disabled={busy === r.id}
                              className="text-[11px] font-semibold px-2.5 py-1 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 disabled:opacity-60">
                              Contacted
                            </button>
                            <button onClick={() => openConvert(r)} disabled={busy === r.id}
                              className="text-[11px] font-semibold px-2.5 py-1 rounded-lg bg-green-600 text-white hover:bg-green-700 disabled:opacity-60">
                              Convert →
                            </button>
                            <button onClick={() => markLost(r)} disabled={busy === r.id}
                              className="text-[11px] font-semibold px-2.5 py-1 rounded-lg border border-slate-200 text-slate-400 hover:text-red-500 hover:border-red-200 disabled:opacity-60">
                              Lost
                            </button>
                          </>
                        ) : (
                          <>
                            <span className={`text-[11px] font-bold px-2.5 py-1 rounded-lg ${r.status === 'won' ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-500'}`}>
                              {r.status === 'won' ? '✓ Won' : 'Lost'}
                            </span>
                            {r.status === 'lost' && (
                              <button onClick={() => reopen(r)} disabled={busy === r.id}
                                className="text-[11px] font-semibold px-2.5 py-1 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 disabled:opacity-60">
                                Reopen
                              </button>
                            )}
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* ── Convert: client + first project + invite, in one action ─────────── */}
      {convert && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={e => e.target === e.currentTarget && !busy && setConvert(null)}>
          <div className="bg-white rounded-2xl p-6 w-full max-w-lg max-h-[90vh] overflow-y-auto">
            {!convDone ? (
              <>
                <h3 className="text-lg font-bold text-[#1F4E79] mb-1">Convert to client</h3>
                <p className="text-[13px] text-slate-500 mb-5">
                  Creates the client, its first project with all five phases in scope, and an invite link for
                  <strong> {convert.full_name}</strong> — the same signup flow used everywhere else.
                </p>
                <div className="space-y-3">
                  <label className="block">
                    <span className="text-[11px] font-semibold text-slate-600">Client name *</span>
                    <input value={convForm.name} onChange={e => setConvForm(f => ({ ...f, name: e.target.value }))}
                      className="w-full mt-1 border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#1F4E79]" />
                  </label>
                  <label className="block">
                    <span className="text-[11px] font-semibold text-slate-600">Industry</span>
                    <input value={convForm.industry} onChange={e => setConvForm(f => ({ ...f, industry: e.target.value }))}
                      placeholder="e.g. Utilities & Energy"
                      className="w-full mt-1 border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#1F4E79]" />
                  </label>
                  <label className="block">
                    <span className="text-[11px] font-semibold text-slate-600">First project *</span>
                    <input value={convForm.project} onChange={e => setConvForm(f => ({ ...f, project: e.target.value }))}
                      className="w-full mt-1 border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#1F4E79]" />
                    <span className="block text-[11px] text-slate-400 mt-1">
                      All five phases start in scope and locked. Narrow the scope on the client page once you know the programme.
                    </span>
                  </label>
                  <label className="block">
                    <span className="text-[11px] font-semibold text-slate-600">Access Persona *</span>
                    <select value={convForm.role} onChange={e => setConvForm(f => ({ ...f, role: e.target.value }))}
                      className="w-full mt-1 border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:border-[#1F4E79]">
                      <option value="">Select…</option>
                      {allRoles.map(r => <option key={r.code} value={r.code}>{r.label}</option>)}
                    </select>
                    <span className="block text-[11px] text-slate-400 mt-1">Decides which content they see. Onboarding is skipped for invited users.</span>
                  </label>
                  <label className="flex items-start gap-2.5 pt-1">
                    <input type="checkbox" checked={convForm.as_client_admin}
                      onChange={e => setConvForm(f => ({ ...f, as_client_admin: e.target.checked }))}
                      className="mt-0.5 accent-[#1F4E79]" />
                    <span className="text-[12px] text-slate-600">
                      Make them a <strong>Client Admin</strong> — they can then run their own programme and invite their team.
                      Usually right for the person who signed up.
                    </span>
                  </label>
                </div>
                {convErr && <p className="text-xs text-red-500 mt-3 font-medium">⚠ {convErr}</p>}
                <div className="flex gap-2 mt-5">
                  <button onClick={doConvert} disabled={busy === convert.id}
                    className="flex-1 bg-green-600 text-white text-sm font-semibold px-4 py-2.5 rounded-lg hover:bg-green-700 disabled:opacity-60">
                    {busy === convert.id ? 'Creating…' : 'Create client & invite'}
                  </button>
                  <button onClick={() => setConvert(null)} disabled={busy === convert.id}
                    className="px-4 py-2.5 rounded-lg border border-slate-200 text-slate-600 text-sm font-semibold hover:bg-slate-50 disabled:opacity-60">
                    Cancel
                  </button>
                </div>
              </>
            ) : (
              <>
                <div className="w-12 h-12 rounded-full bg-green-50 grid place-items-center mx-auto mb-4">
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none"><path d="M20 6 9 17l-5-5" stroke="#16a34a" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
                </div>
                <h3 className="text-lg font-bold text-[#1F4E79] text-center mb-1">{convForm.name} is a client</h3>
                <p className="text-[13px] text-slate-500 text-center mb-5">
                  Client, project and invite all created. Send this link to {convDone.email} — they register and land straight in.
                </p>
                <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 mb-4">
                  <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide mb-1.5">Invite link</p>
                  <p className="text-[11px] text-slate-600 break-all font-mono">{inviteLink(convDone.token)}</p>
                </div>
                <div className="flex gap-2">
                  <button onClick={() => copyInvite(convDone.token)}
                    className="flex-1 bg-[#1F4E79] text-white text-sm font-semibold px-4 py-2.5 rounded-lg hover:bg-[#17395a]">
                    {copied ? 'Copied ✓' : 'Copy invite link'}
                  </button>
                  <button onClick={() => { setConvert(null); setConvDone(null) }}
                    className="px-4 py-2.5 rounded-lg border border-slate-200 text-slate-600 text-sm font-semibold hover:bg-slate-50">
                    Done
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
