import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../lib/supabase'
import { MemberDashboard } from './Dashboard'

// Master Admin "view as": preview the member experience either as a persona (read-only,
// no real data) or as a specific member (their real progress + responses).
export default function AdminPreview() {
  const { profile } = useAuth()
  const [clients,  setClients]  = useState([])
  const [projects, setProjects] = useState([])
  const [roles,    setRoles]    = useState([])
  const [members,  setMembers]  = useState([])

  const [projectId, setProjectId] = useState('')
  const [mode,      setMode]      = useState('persona')  // 'persona' | 'member'
  const [persona,   setPersona]   = useState('')
  const [memberId,  setMemberId]  = useState('')
  const [preview,   setPreview]   = useState(null)

  // Deep link from the AI Canvas: /admin/preview?project=<id>&user=<id> → auto-open that member.
  const [params] = useSearchParams()
  const deepProject = params.get('project')
  const deepUser    = params.get('user')

  useEffect(() => {
    Promise.all([
      supabase.from('clients').select('id, name, industry').order('name'),
      supabase.from('projects').select('id, name, client_id'),
      supabase.from('roles').select('*').order('sort_order'),
    ]).then(([c, p, r]) => {
      setClients(c.data ?? []); setProjects(p.data ?? []); setRoles(r.data ?? [])
    })
  }, [])

  // Apply a deep link once: preselect the project + member mode.
  useEffect(() => {
    if (deepProject) { setProjectId(deepProject); setMode('member') }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deepProject])

  // When that project's members load, auto-start the preview for the deep-linked user.
  useEffect(() => {
    if (!deepUser || preview) return
    const m = members.find(x => x.id === deepUser)
    if (m) { setMemberId(deepUser); setPreview({ userId: deepUser, projectId: deepProject, profile: m }) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [members, deepUser])

  // Load the chosen project's members (for the "view as member" dropdown)
  useEffect(() => {
    setMemberId(''); setMembers([])
    if (!projectId) return
    supabase.from('project_members').select('user_id').eq('project_id', projectId).then(async ({ data }) => {
      const ids = [...new Set((data ?? []).map(m => m.user_id))]
      if (!ids.length) { setMembers([]); return }
      const { data: profs } = await supabase.from('profiles').select('id, full_name, role, industry').in('id', ids)
      setMembers(profs ?? [])
    })
  }, [projectId])

  if (!profile?.is_admin) {
    return <div className="p-8 text-center text-slate-500">You don't have permission to access this page.</div>
  }

  const proj    = projects.find(p => p.id === projectId)
  const client  = clients.find(c => c.id === proj?.client_id)
  const canGo   = projectId && (mode === 'persona' ? !!persona : !!memberId)

  function startPreview() {
    if (mode === 'persona') {
      const r = roles.find(x => x.code === persona)
      setPreview({
        userId: null, projectId,
        profile: { role: persona, industry: client?.industry ?? null,
                   full_name: `${r?.label ?? 'Persona'} (preview)`, onboarding_done: true },
      })
    } else {
      const m = members.find(x => x.id === memberId)
      setPreview({ userId: memberId, projectId, profile: m })
    }
  }

  const previewLabel = preview
    ? (preview.userId
        ? `${preview.profile?.full_name ?? 'member'}`
        : `${preview.profile?.full_name ?? 'persona'}`)
    : ''

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="px-8 pt-8">
        <p className="text-xs font-semibold text-slate-400 uppercase tracking-widest">Platform Admin</p>
        <h1 className="text-2xl font-bold text-slate-800 mb-1">View as member</h1>
        <p className="text-sm text-slate-500 mb-5">
          See the member experience for any project — as a persona (read-only, no personal data) or as a specific person (their real progress).
        </p>

        {/* Controls */}
        <div className="bg-white rounded-2xl border border-slate-100 p-5 flex flex-wrap items-end gap-4">
          <div>
            <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">Project</label>
            <select value={projectId} onChange={e => { setProjectId(e.target.value); setPreview(null) }}
              className="border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:border-[#1F4E79] min-w-[220px]">
              <option value="">Select a project…</option>
              {projects.map(p => {
                const cn = clients.find(c => c.id === p.client_id)?.name
                return <option key={p.id} value={p.id}>{cn ? `${cn} — ` : ''}{p.name}</option>
              })}
            </select>
          </div>

          <div>
            <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">View as</label>
            <div className="flex gap-1 bg-slate-100 rounded-lg p-1">
              {['persona', 'member'].map(m => (
                <button key={m} onClick={() => { setMode(m); setPreview(null) }}
                  className={`px-3 py-1.5 rounded-md text-xs font-semibold capitalize transition-colors ${mode === m ? 'bg-white text-[#1F4E79] shadow-sm' : 'text-slate-500'}`}>
                  {m === 'persona' ? 'Persona' : 'Specific member'}
                </button>
              ))}
            </div>
          </div>

          {mode === 'persona' ? (
            <div>
              <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">Persona</label>
              <select value={persona} onChange={e => { setPersona(e.target.value); setPreview(null) }}
                className="border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:border-[#1F4E79] min-w-[180px]">
                <option value="">Select a persona…</option>
                {roles.map(r => <option key={r.code} value={r.code}>{r.label}</option>)}
              </select>
            </div>
          ) : (
            <div>
              <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">Member</label>
              <select value={memberId} onChange={e => { setMemberId(e.target.value); setPreview(null) }} disabled={!projectId}
                className="border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:border-[#1F4E79] min-w-[180px] disabled:opacity-50">
                <option value="">{projectId ? (members.length ? 'Select a member…' : 'No members') : 'Pick a project first'}</option>
                {members.map(m => <option key={m.id} value={m.id}>{m.full_name ?? m.id}{m.role ? ` (${m.role})` : ''}</option>)}
              </select>
            </div>
          )}

          <button onClick={startPreview} disabled={!canGo}
            className="bg-[#1F4E79] text-white text-sm font-semibold px-5 py-2.5 rounded-lg hover:bg-[#163a5c] transition-colors disabled:opacity-50">
            View →
          </button>
          <Link to="/dashboard" className="text-sm font-semibold text-slate-400 hover:text-[#1F4E79] ml-auto">← Back to my dashboard</Link>
        </div>
      </div>

      {/* Preview */}
      {preview && (
        <div className="mt-6">
          <div className="mx-8 mb-0 flex items-center gap-3 bg-amber-50 border border-amber-200 rounded-t-2xl px-5 py-3">
            <span className="text-[10px] font-bold bg-amber-200 text-amber-800 px-2 py-0.5 rounded-full">READ-ONLY PREVIEW</span>
            <span className="text-sm text-amber-800">
              Viewing as <strong>{previewLabel}</strong>
              {preview.userId ? ' — their real progress' : ' — persona view, no personal data'} · {proj?.name}
            </span>
            <button onClick={() => setPreview(null)} className="ml-auto text-xs font-semibold text-amber-700 hover:text-amber-900">Exit ✕</button>
          </div>
          <div className="mx-8 border-x border-b border-amber-200 rounded-b-2xl overflow-hidden bg-white">
            <MemberDashboard preview={preview} />
          </div>
        </div>
      )}
    </div>
  )
}
