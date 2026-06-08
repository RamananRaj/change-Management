import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'

const PHASES = [1, 2, 3, 4, 5]
const PHASE_NAMES = { 1: 'Diagnose', 2: 'Design', 3: 'Engage', 4: 'Embed', 5: 'Evaluate' }
const PHASE_ICONS = { 1: '🔍', 2: '📐', 3: '🤝', 4: '🔧', 5: '📊' }
const PROJECT_STATUS = ['planning', 'active', 'completed', 'on_hold']
const PROJECT_STATUS_COLORS = {
  planning:   'bg-slate-100 text-slate-600',
  active:     'bg-blue-100 text-blue-700',
  completed:  'bg-green-100 text-green-700',
  on_hold:    'bg-amber-100 text-amber-700',
}
const PHASE_STATUS_CYCLE = { locked: 'active', active: 'completed', completed: 'locked' }
const PHASE_STATUS_DISPLAY = {
  locked:    { label: 'Locked',    color: 'bg-slate-100 text-slate-400', icon: '🔒' },
  active:    { label: 'Active',    color: 'bg-blue-100 text-blue-700',   icon: '⟳' },
  completed: { label: 'Done',      color: 'bg-green-100 text-green-700', icon: '✓' },
}

const emptyClientForm  = { name: '', industry: '', contact_name: '', contact_email: '', notes: '', is_active: true }
const emptyProjectForm = { name: '', description: '', status: 'planning' }

// ── helpers ────────────────────────────────────────────────────────────────────
function StatusDot({ status }) {
  if (status === 'completed')   return <span className="text-green-500 font-bold">✓</span>
  if (status === 'in_progress') return <span className="text-blue-400 text-[10px] font-bold leading-none">●</span>
  return <span className="text-slate-200">—</span>
}

// ── Main component ────────────────────────────────────────────────────────────
export default function AdminClients({ allRoles = [] }) {
  const { user } = useAuth()
  const [clients,        setClients]        = useState([])
  const [allUsers,       setAllUsers]       = useState([])
  const [industries,     setIndustries]     = useState([])
  const [loading,        setLoading]        = useState(false)
  const [selectedClient, setSelectedClient] = useState(null)
  const [clientTab,      setClientTab]      = useState('projects')

  // Client form
  const [showClientForm, setShowClientForm] = useState(false)
  const [clientForm,     setClientForm]     = useState(emptyClientForm)
  const [clientEditId,   setClientEditId]   = useState(null)
  const [clientSaving,   setClientSaving]   = useState(false)
  const [clientError,    setClientError]    = useState(null)

  // Projects state
  const [projects,       setProjects]       = useState([])
  const [expandedProject, setExpandedProject] = useState(null)
  const [projectPhases,  setProjectPhases]  = useState({}) // { project_id: [phases] }
  const [projectMembers, setProjectMembers] = useState({}) // { project_id: [users] }
  const [projectInvites, setProjectInvites] = useState({}) // { project_id: [pending invites] }
  const [inviteForm,     setInviteForm]     = useState({}) // { project_id: { email, full_name, role } }
  const [inviteBusy,     setInviteBusy]     = useState(null) // project_id currently saving
  const [copiedToken,    setCopiedToken]    = useState(null)
  const [showProjectForm, setShowProjectForm] = useState(false)
  const [projectForm,    setProjectForm]    = useState(emptyProjectForm)
  const [projectEditId,  setProjectEditId]  = useState(null)
  const [projectSaving,  setProjectSaving]  = useState(false)
  const [projectError,   setProjectError]   = useState(null)

  // Pathway state
  const [pathwayPhase,   setPathwayPhase]   = useState(1)
  const [phaseContent,   setPhaseContent]   = useState([])
  const [clientPathway,  setClientPathway]  = useState([])
  const [pathwaySaving,  setPathwaySaving]  = useState(false)

  // Progress state
  const [progressData,   setProgressData]   = useState({ users: [], items: [], activities: [] })

  useEffect(() => { fetchClients(); fetchAllUsers(); fetchIndustries() }, [])

  async function fetchClients() {
    setLoading(true)
    const { data } = await supabase.from('clients').select('*').order('name')
    setClients(data ?? [])
    setLoading(false)
  }

  async function fetchIndustries() {
    const { data } = await supabase.from('industries').select('code, label, icon').eq('is_active', true).order('sort_order')
    setIndustries(data ?? [])
  }

  // Map a stored industry code to a display label (with icon). Falls back to the raw value.
  function industryLabel(code) {
    const ind = industries.find(i => i.code === code)
    return ind ? `${ind.icon ?? ''} ${ind.label}`.trim() : code
  }

  async function fetchAllUsers() {
    const { data } = await supabase.from('profiles').select('id, full_name, role, industry, client_id').order('full_name')
    setAllUsers(data ?? [])
  }

  // ── Open client ─────────────────────────────────────────────────────────────
  async function openClient(client) {
    setSelectedClient(client)
    setClientTab('projects')
    setExpandedProject(null)
    await loadProjects(client.id)
  }

  async function loadProjects(clientId) {
    const { data } = await supabase
      .from('projects')
      .select('*')
      .eq('client_id', clientId)
      .order('created_at', { ascending: false })
    setProjects(data ?? [])
  }

  // ── Expand project ───────────────────────────────────────────────────────────
  async function expandProject(project) {
    if (expandedProject?.id === project.id) { setExpandedProject(null); return }
    setExpandedProject(project)
    await Promise.all([
      loadProjectPhases(project.id),
      loadProjectMembers(project.id),
      loadProjectInvites(project.id),
    ])
  }

  async function loadProjectInvites(projectId) {
    const { data } = await supabase
      .from('project_invites')
      .select('*')
      .eq('project_id', projectId)
      .eq('status', 'pending')
      .order('created_at', { ascending: false })
    setProjectInvites(prev => ({ ...prev, [projectId]: data ?? [] }))
  }

  function inviteLink(token) {
    return `${window.location.origin}/auth/signup?invite=${token}`
  }

  async function createInvite(projectId) {
    const f = inviteForm[projectId] ?? {}
    const email = (f.email ?? '').trim()
    if (!email) return
    setInviteBusy(projectId)
    const { error } = await supabase.from('project_invites').insert({
      project_id: projectId,
      client_id:  selectedClient.id,
      email,
      full_name:  (f.full_name ?? '').trim() || null,
      role:       f.role || null,
      invited_by: user.id,
    })
    setInviteBusy(null)
    if (error) { window.alert('Could not create invite: ' + error.message); return }
    setInviteForm(prev => ({ ...prev, [projectId]: { email: '', full_name: '', role: '' } }))
    await loadProjectInvites(projectId)
  }

  async function copyInvite(token) {
    try {
      await navigator.clipboard.writeText(inviteLink(token))
      setCopiedToken(token)
      setTimeout(() => setCopiedToken(null), 1800)
    } catch { /* clipboard blocked — user can still select the text */ }
  }

  async function revokeInvite(projectId, inviteId) {
    if (!window.confirm('Revoke this invite? The link will stop working.')) return
    await supabase.from('project_invites').update({ status: 'revoked' }).eq('id', inviteId)
    await loadProjectInvites(projectId)
  }

  async function loadProjectPhases(projectId) {
    const { data } = await supabase
      .from('project_phases')
      .select('*')
      .eq('project_id', projectId)
      .order('phase_number')
    setProjectPhases(prev => ({ ...prev, [projectId]: data ?? [] }))
  }

  async function loadProjectMembers(projectId) {
    // Two-step: project_members.user_id FKs to auth.users, not profiles, so a
    // PostgREST embed can't resolve. Fetch member ids, then their profiles.
    const { data: rows } = await supabase
      .from('project_members')
      .select('user_id')
      .eq('project_id', projectId)
    const ids = (rows ?? []).map(r => r.user_id)
    if (ids.length === 0) { setProjectMembers(prev => ({ ...prev, [projectId]: [] })); return }
    const { data: profs } = await supabase
      .from('profiles')
      .select('id, full_name, role')
      .in('id', ids)
    setProjectMembers(prev => ({ ...prev, [projectId]: profs ?? [] }))
  }

  // ── Phase access toggle ──────────────────────────────────────────────────────
  async function togglePhase(projectId, phaseNum, currentStatus) {
    const nextStatus = PHASE_STATUS_CYCLE[currentStatus ?? 'locked']
    const existing = (projectPhases[projectId] ?? []).find(p => p.phase_number === phaseNum)

    if (existing) {
      await supabase.from('project_phases').update({ status: nextStatus }).eq('id', existing.id)
    } else {
      await supabase.from('project_phases').insert({ project_id: projectId, phase_number: phaseNum, status: nextStatus })
    }
    await loadProjectPhases(projectId)
  }

  function getPhaseStatus(projectId, phaseNum) {
    return (projectPhases[projectId] ?? []).find(p => p.phase_number === phaseNum)?.status ?? 'locked'
  }

  // ── Member management ────────────────────────────────────────────────────────
  async function assignMember(projectId, userId) {
    // Add to project_members (surface any failure instead of silently doing nothing)
    const { error } = await supabase
      .from('project_members')
      .upsert({ project_id: projectId, user_id: userId }, { onConflict: 'project_id,user_id' })
    if (error) { window.alert('Could not assign member: ' + error.message); return }
    // Sync client_id on profile (best-effort)
    await supabase.from('profiles').update({ client_id: selectedClient.id }).eq('id', userId)
    await Promise.all([loadProjectMembers(projectId), fetchAllUsers()])
  }

  async function removeMember(projectId, userId) {
    if (!window.confirm('Remove this user from the project?')) return
    await supabase.from('project_members').delete().eq('project_id', projectId).eq('user_id', userId)
    await Promise.all([loadProjectMembers(projectId), fetchAllUsers()])
  }

  // ── Project CRUD ─────────────────────────────────────────────────────────────
  async function saveProject() {
    if (!projectForm.name.trim()) { setProjectError('Project name is required'); return }
    setProjectSaving(true)
    setProjectError(null)
    let error
    if (projectEditId) {
      ;({ error } = await supabase.from('projects').update({ ...projectForm }).eq('id', projectEditId))
    } else {
      const { data: newProj, error: insErr } = await supabase
        .from('projects')
        .insert({ ...projectForm, client_id: selectedClient.id, user_id: user.id })
        .select().single()
      error = insErr
      // Initialise all phases as locked
      if (newProj) {
        await supabase.from('project_phases').insert(
          PHASES.map(ph => ({ project_id: newProj.id, phase_number: ph, status: 'locked' }))
        )
      }
    }
    setProjectSaving(false)
    if (error) { setProjectError(error.message); return }
    setShowProjectForm(false)
    setProjectForm(emptyProjectForm)
    setProjectEditId(null)
    await loadProjects(selectedClient.id)
  }

  async function deleteProject(id) {
    if (!window.confirm('Delete this project? Members will be unassigned.')) return
    await supabase.from('projects').delete().eq('id', id)
    setExpandedProject(null)
    await loadProjects(selectedClient.id)
  }

  // ── Client CRUD ──────────────────────────────────────────────────────────────
  async function saveClient() {
    if (!clientForm.name.trim()) { setClientError('Name is required'); return }
    setClientSaving(true)
    const payload = { ...clientForm, industry: clientForm.industry || null, contact_name: clientForm.contact_name || null,
      contact_email: clientForm.contact_email || null, notes: clientForm.notes || null }
    let error
    if (clientEditId) {
      ;({ error } = await supabase.from('clients').update(payload).eq('id', clientEditId))
    } else {
      ;({ error } = await supabase.from('clients').insert(payload))
    }
    setClientSaving(false)
    if (error) { setClientError(error.message); return }
    setShowClientForm(false)
    setClientError(null)
    fetchClients()
  }

  async function deleteClient(id) {
    if (!window.confirm('Delete this client? Projects and members will be removed.')) return
    await supabase.from('clients').delete().eq('id', id)
    fetchClients()
    if (selectedClient?.id === id) setSelectedClient(null)
  }

  // ── Pathway ──────────────────────────────────────────────────────────────────
  async function loadPathway(phase) {
    setPathwayPhase(phase)
    const [{ data: content }, { data: pathway }] = await Promise.all([
      supabase.from('phase_content').select('id, title, content_type, role, industry').eq('phase_number', phase).order('sort_order'),
      supabase.from('client_pathways').select('*').eq('client_id', selectedClient.id).eq('phase_number', phase).order('pathway_step'),
    ])
    setPhaseContent(content ?? [])
    setClientPathway(pathway ?? [])
  }

  function getStep(contentId) {
    return clientPathway.find(p => p.content_id === contentId)?.pathway_step ?? ''
  }

  function setStep(contentId, step) {
    const filtered = clientPathway.filter(p => p.content_id !== contentId)
    const cleaned  = step ? filtered.filter(p => p.pathway_step !== Number(step)) : filtered
    setClientPathway(step ? [...cleaned, { content_id: contentId, pathway_step: Number(step) }] : cleaned)
  }

  async function savePathway() {
    setPathwaySaving(true)
    await supabase.from('client_pathways').delete().eq('client_id', selectedClient.id).eq('phase_number', pathwayPhase)
    if (clientPathway.length > 0) {
      await supabase.from('client_pathways').insert(
        clientPathway.map(p => ({ client_id: selectedClient.id, phase_number: pathwayPhase, content_id: p.content_id, pathway_step: p.pathway_step }))
      )
    }
    setPathwaySaving(false)
  }

  // ── Progress ─────────────────────────────────────────────────────────────────
  async function loadProgress() {
    // All users in all projects under this client (two-step: no profiles embed).
    const { data: memberships } = await supabase
      .from('project_members')
      .select('user_id, project_id')
      .in('project_id', projects.map(p => p.id))

    const memberIds = [...new Set((memberships ?? []).map(m => m.user_id))]
    const { data: memberProfiles } = memberIds.length
      ? await supabase.from('profiles').select('id, full_name, role').in('id', memberIds)
      : { data: [] }
    const profileById = new Map((memberProfiles ?? []).map(p => [p.id, p]))

    const uniqueUsers = []
    const seen = new Set()
    for (const m of memberships ?? []) {
      const prof = profileById.get(m.user_id)
      if (prof && !seen.has(prof.id)) {
        seen.add(prof.id)
        uniqueUsers.push(prof)
      }
    }

    if (uniqueUsers.length === 0) { setProgressData({ users: [], items: [], activities: [] }); return }

    const [{ data: items }, { data: activities }] = await Promise.all([
      supabase.from('phase_content').select('id, title, content_type, phase_number').order('phase_number').order('sort_order'),
      supabase.from('user_activities').select('user_id, content_id, status').in('user_id', uniqueUsers.map(u => u.id)),
    ])
    setProgressData({ users: uniqueUsers, items: items ?? [], activities: activities ?? [] })
  }

  function getActivity(userId, contentId) {
    return progressData.activities.find(a => a.user_id === userId && a.content_id === contentId)?.status ?? null
  }

  // ── RENDER ────────────────────────────────────────────────────────────────────

  // Modals are shared across both the client-list and client-detail views so they
  // render no matter which branch is active.
  const modals = (
    <>
      {/* ── Client form modal ── */}
      {showClientForm && (
        <>
          <div className="fixed inset-0 bg-black/40 z-40" onClick={() => setShowClientForm(false)} />
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 pointer-events-none">
            <div className="bg-white rounded-2xl shadow-2xl pointer-events-auto w-full max-w-md">
              <div className="px-6 py-5 border-b border-slate-100 flex items-center justify-between">
                <h3 className="font-bold text-slate-800">{clientEditId ? 'Edit Client' : 'New Client'}</h3>
                <button onClick={() => setShowClientForm(false)} className="w-7 h-7 rounded-full bg-slate-100 hover:bg-slate-200 flex items-center justify-center text-slate-500 text-xs">✕</button>
              </div>
              <div className="px-6 py-5 space-y-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">Organisation Name *</label>
                  <input value={clientForm.name} onChange={e => setClientForm({...clientForm, name: e.target.value})}
                    placeholder="e.g. Acme Energy Co."
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#1F4E79]" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">Industry</label>
                  <select value={clientForm.industry} onChange={e => setClientForm({...clientForm, industry: e.target.value})}
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#1F4E79] bg-white">
                    <option value="">Select an industry…</option>
                    {industries.map(ind => (
                      <option key={ind.code} value={ind.code}>{ind.icon} {ind.label}</option>
                    ))}
                  </select>
                  <p className="text-[10px] text-slate-400 mt-1">Managed in Admin → Industry Manager. Links clients to the right pathways and reporting.</p>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-slate-600 mb-1">Contact Name</label>
                    <input value={clientForm.contact_name} onChange={e => setClientForm({...clientForm, contact_name: e.target.value})}
                      placeholder="Jane Smith"
                      className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#1F4E79]" />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-600 mb-1">Contact Email</label>
                    <input value={clientForm.contact_email} onChange={e => setClientForm({...clientForm, contact_email: e.target.value})}
                      placeholder="jane@acme.com" type="email"
                      className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#1F4E79]" />
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">Notes</label>
                  <textarea value={clientForm.notes} onChange={e => setClientForm({...clientForm, notes: e.target.value})}
                    rows={2} placeholder="Any notes…"
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm resize-none focus:outline-none focus:border-[#1F4E79]" />
                </div>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={clientForm.is_active} onChange={e => setClientForm({...clientForm, is_active: e.target.checked})} className="w-4 h-4 accent-[#1F4E79]" />
                  <span className="text-sm text-slate-700">Active</span>
                </label>
                {clientError && <p className="text-sm text-red-500">{clientError}</p>}
              </div>
              <div className="px-6 py-4 border-t border-slate-100 flex justify-end gap-3">
                <button onClick={() => setShowClientForm(false)} className="text-sm text-slate-500 px-4 py-2">Cancel</button>
                <button onClick={saveClient} disabled={clientSaving}
                  className="bg-[#1F4E79] text-white text-sm font-semibold px-6 py-2 rounded-lg hover:bg-[#163a5c] transition-colors disabled:opacity-60">
                  {clientSaving ? 'Saving…' : clientEditId ? 'Save Changes' : 'Create Client'}
                </button>
              </div>
            </div>
          </div>
        </>
      )}

      {/* ── Project form modal ── */}
      {showProjectForm && (
        <>
          <div className="fixed inset-0 bg-black/40 z-40" onClick={() => setShowProjectForm(false)} />
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 pointer-events-none">
            <div className="bg-white rounded-2xl shadow-2xl pointer-events-auto w-full max-w-sm">
              <div className="px-6 py-5 border-b border-slate-100 flex items-center justify-between">
                <h3 className="font-bold text-slate-800">{projectEditId ? 'Edit Project' : 'New Project'}</h3>
                <button onClick={() => setShowProjectForm(false)} className="w-7 h-7 rounded-full bg-slate-100 flex items-center justify-center text-slate-500 text-xs">✕</button>
              </div>
              <div className="px-6 py-5 space-y-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">Project Name *</label>
                  <input value={projectForm.name} onChange={e => setProjectForm({...projectForm, name: e.target.value})}
                    placeholder="e.g. Q1 ERP Rollout"
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#1F4E79]" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">Description</label>
                  <textarea value={projectForm.description} onChange={e => setProjectForm({...projectForm, description: e.target.value})}
                    rows={2} placeholder="Brief description…"
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm resize-none focus:outline-none focus:border-[#1F4E79]" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">Status</label>
                  <select value={projectForm.status} onChange={e => setProjectForm({...projectForm, status: e.target.value})}
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#1F4E79] bg-white">
                    {PROJECT_STATUS.map(s => <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1).replace('_',' ')}</option>)}
                  </select>
                </div>
                {projectError && <p className="text-sm text-red-500">{projectError}</p>}
              </div>
              <div className="px-6 py-4 border-t border-slate-100 flex justify-end gap-3">
                <button onClick={() => setShowProjectForm(false)} className="text-sm text-slate-500 px-4 py-2">Cancel</button>
                <button onClick={saveProject} disabled={projectSaving}
                  className="bg-[#1F4E79] text-white text-sm font-semibold px-6 py-2 rounded-lg hover:bg-[#163a5c] transition-colors disabled:opacity-60">
                  {projectSaving ? 'Saving…' : projectEditId ? 'Save' : 'Create Project'}
                </button>
              </div>
            </div>
          </div>
        </>
      )}
    </>
  )

  // ── Client Detail ────────────────────────────────────────────────────────────
  if (selectedClient) {
    const phaseGroups = PHASES.map(ph => ({
      phase: ph, items: progressData.items.filter(i => i.phase_number === ph)
    })).filter(g => g.items.length > 0)

    return (
      <div>
        {/* Header */}
        <div className="flex items-center gap-3 mb-6">
          <button onClick={() => setSelectedClient(null)} className="text-sm text-slate-500 hover:text-slate-700">← All Clients</button>
          <span className="text-slate-300">/</span>
          <div className="w-8 h-8 rounded-lg bg-[#1F4E79]/10 flex items-center justify-center font-bold text-[#1F4E79] text-sm shrink-0">
            {selectedClient.name.charAt(0).toUpperCase()}
          </div>
          <div>
            <h2 className="font-bold text-slate-800 leading-tight">{selectedClient.name}</h2>
            {selectedClient.industry && <p className="text-xs text-slate-400">{industryLabel(selectedClient.industry)}</p>}
          </div>
          {selectedClient.contact_name && (
            <span className="text-xs text-slate-400 ml-2">Contact: {selectedClient.contact_name}{selectedClient.contact_email ? ` · ${selectedClient.contact_email}` : ''}</span>
          )}
          <div className="ml-auto flex gap-2">
            <button onClick={() => { setClientForm({ name: selectedClient.name, industry: selectedClient.industry ?? '', contact_name: selectedClient.contact_name ?? '', contact_email: selectedClient.contact_email ?? '', notes: selectedClient.notes ?? '', is_active: selectedClient.is_active }); setClientEditId(selectedClient.id); setShowClientForm(true) }}
              className="text-xs text-[#1F4E79] border border-[#1F4E79]/30 px-3 py-1.5 rounded-lg hover:bg-[#1F4E79]/5 transition-colors">
              Edit Client
            </button>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 mb-6 border-b border-slate-100">
          {[['projects', '📁 Projects'], ['pathway', '🗺️ Pathway'], ['progress', '📊 Progress']].map(([key, label]) => (
            <button key={key}
              onClick={() => {
                setClientTab(key)
                if (key === 'pathway' && phaseContent.length === 0) loadPathway(1)
                if (key === 'progress') loadProgress()
              }}
              className={`px-4 py-2 text-sm font-semibold border-b-2 transition-colors -mb-px ${
                clientTab === key ? 'border-[#1F4E79] text-[#1F4E79]' : 'border-transparent text-slate-500 hover:text-slate-700'
              }`}>
              {label}
            </button>
          ))}
        </div>

        {/* ── PROJECTS TAB ── */}
        {clientTab === 'projects' && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold text-slate-400 uppercase tracking-widest">Projects ({projects.length})</p>
              <button
                onClick={() => { setProjectForm(emptyProjectForm); setProjectEditId(null); setShowProjectForm(true) }}
                className="bg-[#E8913A] text-white text-xs font-semibold px-3 py-1.5 rounded-lg hover:bg-[#d07e2e] transition-colors">
                + New Project
              </button>
            </div>

            {projects.length === 0 ? (
              <div className="text-center py-10 bg-slate-50 rounded-2xl border border-slate-100">
                <p className="text-slate-400 text-sm">No projects yet for this client.</p>
                <p className="text-slate-300 text-xs mt-1">Create a project to assign users and manage phase access.</p>
              </div>
            ) : (
              projects.map(project => {
                const isExpanded = expandedProject?.id === project.id
                const members = projectMembers[project.id] ?? []
                const phases  = projectPhases[project.id] ?? []
                const activePhaseCount = phases.filter(p => p.status !== 'locked').length
                const statusCfg = PROJECT_STATUS_COLORS[project.status] ?? PROJECT_STATUS_COLORS.active

                return (
                  <div key={project.id} className={`bg-white border rounded-2xl overflow-hidden transition-all ${isExpanded ? 'border-[#1F4E79]/20 shadow-md' : 'border-slate-100 hover:border-slate-200'}`}>

                    {/* Project header row */}
                    <div className="flex items-center gap-3 px-5 py-4 cursor-pointer" onClick={() => expandProject(project)}>
                      <div className="w-8 h-8 rounded-lg bg-[#1F4E79]/10 flex items-center justify-center text-sm font-bold text-[#1F4E79] shrink-0">
                        {project.name.charAt(0).toUpperCase()}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="font-semibold text-slate-800 text-sm">{project.name}</p>
                          <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${statusCfg}`}>{project.status}</span>
                        </div>
                        <p className="text-xs text-slate-400 mt-0.5">
                          {members.length > 0 ? `${members.length} member${members.length !== 1 ? 's' : ''}` : 'No members yet'}
                          {activePhaseCount > 0 ? ` · ${activePhaseCount} phase${activePhaseCount !== 1 ? 's' : ''} unlocked` : ' · All phases locked'}
                        </p>
                      </div>
                      <div className="flex gap-2 shrink-0 items-center">
                        <button onClick={e => { e.stopPropagation(); setProjectForm({ name: project.name, description: project.description ?? '', status: project.status }); setProjectEditId(project.id); setShowProjectForm(true) }}
                          className="text-xs text-slate-400 hover:text-[#1F4E79]">Edit</button>
                        <button onClick={e => { e.stopPropagation(); deleteProject(project.id) }}
                          className="text-xs text-red-400 hover:text-red-600">Delete</button>
                        <svg className={`w-4 h-4 text-slate-300 transition-transform ${isExpanded ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7 7" />
                        </svg>
                      </div>
                    </div>

                    {/* Expanded detail */}
                    {isExpanded && (
                      <div className="border-t border-slate-100 px-5 py-4 space-y-5 bg-slate-50/50">

                        {/* Phase access */}
                        <div>
                          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2">Phase Access — click to cycle: Locked → Active → Done</p>
                          <div className="flex gap-2 flex-wrap">
                            {PHASES.map(ph => {
                              const status = getPhaseStatus(project.id, ph)
                              const cfg    = PHASE_STATUS_DISPLAY[status] ?? PHASE_STATUS_DISPLAY.locked
                              return (
                                <button key={ph}
                                  onClick={() => togglePhase(project.id, ph, status)}
                                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold border transition-all ${cfg.color} border-transparent hover:border-current`}>
                                  <span>{cfg.icon}</span>
                                  <span>{String(ph).padStart(2,'0')} {PHASE_NAMES[ph]}</span>
                                </button>
                              )
                            })}
                          </div>
                        </div>

                        {/* Members */}
                        <div>
                          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2">Members</p>
                          {members.length === 0 ? (
                            <p className="text-xs text-slate-400">No members assigned.</p>
                          ) : (
                            <div className="flex flex-wrap gap-2 mb-3">
                              {members.map(u => (
                                <div key={u.id} className="flex items-center gap-1.5 bg-white border border-slate-200 rounded-full px-3 py-1">
                                  <div className="w-5 h-5 rounded-full bg-[#1F4E79]/15 flex items-center justify-center text-[10px] font-bold text-[#1F4E79]">
                                    {(u.full_name ?? '?').charAt(0).toUpperCase()}
                                  </div>
                                  <span className="text-xs font-medium text-slate-700">{u.full_name ?? '—'}</span>
                                  <span className="text-[10px] text-slate-400">{u.role ?? ''}</span>
                                  <button onClick={() => removeMember(project.id, u.id)} className="text-slate-300 hover:text-red-400 ml-1 leading-none">✕</button>
                                </div>
                              ))}
                            </div>
                          )}
                          {/* Assign from dropdown */}
                          <div className="flex gap-2">
                            <select id={`assign-${project.id}`}
                              className="flex-1 border border-slate-200 rounded-lg px-3 py-1.5 text-xs focus:outline-none focus:border-[#1F4E79] bg-white">
                              <option value="">Assign a user…</option>
                              {allUsers.filter(u => !(members.some(m => m.id === u.id))).map(u => (
                                <option key={u.id} value={u.id}>
                                  {u.full_name ?? u.id} {u.role ? `(${u.role})` : ''} {u.client_id && u.client_id !== selectedClient.id ? '[other client]' : ''}
                                </option>
                              ))}
                            </select>
                            <button
                              onClick={() => {
                                const sel = document.getElementById(`assign-${project.id}`)
                                if (sel?.value) { assignMember(project.id, sel.value); sel.value = '' }
                              }}
                              className="bg-[#1F4E79] text-white text-xs font-semibold px-3 py-1.5 rounded-lg hover:bg-[#163a5c] transition-colors">
                              Assign
                            </button>
                          </div>

                          {/* Invite a new person by email (creates a shareable signup link) */}
                          <div className="mt-4 pt-4 border-t border-slate-200/70">
                            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2">Invite someone new</p>

                            {/* Pending invites */}
                            {(projectInvites[project.id] ?? []).length > 0 && (
                              <div className="space-y-2 mb-3">
                                {(projectInvites[project.id] ?? []).map(inv => (
                                  <div key={inv.id} className="flex items-center gap-2 bg-amber-50/70 border border-amber-100 rounded-lg px-3 py-2">
                                    <span className="text-[10px] font-semibold bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full">Pending</span>
                                    <span className="text-xs text-slate-700 font-medium truncate">{inv.email}</span>
                                    {inv.role && <span className="text-[10px] text-slate-400">{(allRoles.find(r => r.code === inv.role)?.label) ?? inv.role}</span>}
                                    <div className="ml-auto flex items-center gap-2 shrink-0">
                                      <button onClick={() => copyInvite(inv.token)}
                                        className="text-[11px] font-semibold text-[#1F4E79] border border-[#1F4E79]/30 px-2 py-1 rounded-md hover:bg-[#1F4E79]/5">
                                        {copiedToken === inv.token ? '✓ Copied' : 'Copy link'}
                                      </button>
                                      <button onClick={() => revokeInvite(project.id, inv.id)}
                                        className="text-[11px] text-red-400 hover:text-red-600">Revoke</button>
                                    </div>
                                  </div>
                                ))}
                              </div>
                            )}

                            {/* New invite form */}
                            <div className="flex gap-2 flex-wrap items-center">
                              <input type="email" placeholder="person@company.com"
                                value={inviteForm[project.id]?.email ?? ''}
                                onChange={e => setInviteForm(prev => ({ ...prev, [project.id]: { ...prev[project.id], email: e.target.value } }))}
                                className="flex-1 min-w-[180px] border border-slate-200 rounded-lg px-3 py-1.5 text-xs focus:outline-none focus:border-[#1F4E79] bg-white" />
                              <select
                                value={inviteForm[project.id]?.role ?? ''}
                                onChange={e => setInviteForm(prev => ({ ...prev, [project.id]: { ...prev[project.id], role: e.target.value } }))}
                                className="border border-slate-200 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:border-[#1F4E79] bg-white">
                                <option value="">Role (optional)</option>
                                {allRoles.map(r => <option key={r.code} value={r.code}>{r.label}</option>)}
                              </select>
                              <button onClick={() => createInvite(project.id)} disabled={inviteBusy === project.id}
                                className="bg-[#E8913A] text-white text-xs font-semibold px-3 py-1.5 rounded-lg hover:bg-[#d07e2e] transition-colors disabled:opacity-60">
                                {inviteBusy === project.id ? 'Creating…' : '+ Invite link'}
                              </button>
                            </div>
                            <p className="text-[10px] text-slate-400 mt-1.5">Creates a signup link you can share. They join this project automatically when they register. Re-copy any time to resend.</p>
                          </div>
                        </div>

                        {/* Description */}
                        {project.description && (
                          <p className="text-xs text-slate-500 italic">{project.description}</p>
                        )}
                      </div>
                    )}
                  </div>
                )
              })
            )}
          </div>
        )}

        {/* ── PATHWAY TAB ── */}
        {clientTab === 'pathway' && (
          <div>
            <p className="text-xs text-slate-500 mb-4">
              Configure the guided pathway for each phase. The steps you set here will appear as the primary journey for all users under <strong>{selectedClient.name}</strong>.
            </p>

            {/* Phase selector */}
            <div className="flex gap-2 mb-5 flex-wrap">
              {PHASES.map(ph => (
                <button key={ph} onClick={() => loadPathway(ph)}
                  className={`px-3 py-1.5 rounded-lg text-sm font-semibold transition-all ${
                    pathwayPhase === ph ? 'bg-[#1F4E79] text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                  }`}>
                  {PHASE_ICONS[ph]} {String(ph).padStart(2,'0')} {PHASE_NAMES[ph]}
                </button>
              ))}
            </div>

            {/* Current summary */}
            {clientPathway.length > 0 && (
              <div className="flex gap-2 flex-wrap mb-4">
                {[...clientPathway].sort((a,b) => a.pathway_step - b.pathway_step).map(p => {
                  const item = phaseContent.find(c => c.id === p.content_id)
                  return (
                    <span key={p.content_id} className="flex items-center gap-1.5 bg-[#1F4E79]/10 text-[#1F4E79] text-xs font-semibold px-2.5 py-1 rounded-full">
                      <span className="bg-[#1F4E79] text-white rounded px-1 text-[10px]">{p.pathway_step}</span>
                      {item?.title ?? 'Item'}
                    </span>
                  )
                })}
              </div>
            )}

            {/* Content list */}
            <div className="space-y-2 mb-4">
              {phaseContent.map(item => (
                <div key={item.id} className="flex items-center gap-3 bg-white border border-slate-100 rounded-xl px-4 py-2.5">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-slate-800 truncate">{item.title}</p>
                    <div className="flex gap-1 mt-0.5">
                      <span className="text-[10px] bg-blue-50 text-blue-600 px-1.5 py-0.5 rounded-full font-semibold">{item.content_type}</span>
                      {item.role     && <span className="text-[10px] bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded-full">{item.role}</span>}
                      {item.industry && <span className="text-[10px] bg-amber-50 text-amber-600 px-1.5 py-0.5 rounded-full">{item.industry}</span>}
                    </div>
                  </div>
                  <select value={getStep(item.id)} onChange={e => setStep(item.id, e.target.value)}
                    className="border border-slate-200 rounded-lg px-2 py-1 text-sm bg-white focus:outline-none focus:border-[#1F4E79] w-28">
                    <option value="">Not in path</option>
                    {[1,2,3,4,5].map(s => <option key={s} value={s}>Step {s}</option>)}
                  </select>
                </div>
              ))}
            </div>

            <button onClick={savePathway} disabled={pathwaySaving}
              className="bg-[#1F4E79] text-white text-sm font-semibold px-6 py-2.5 rounded-xl hover:bg-[#163a5c] transition-colors disabled:opacity-60">
              {pathwaySaving ? 'Saving…' : '✓ Save Phase ' + pathwayPhase + ' Pathway'}
            </button>
          </div>
        )}

        {/* ── PROGRESS TAB ── */}
        {clientTab === 'progress' && (
          <div>
            {progressData.users.length === 0 ? (
              <div className="text-center py-10 text-slate-400 text-sm">No members assigned to projects yet.</div>
            ) : (
              <div className="space-y-8">
                {phaseGroups.map(({ phase, items }) => (
                  <div key={phase}>
                    <p className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-3">
                      {PHASE_ICONS[phase]} Phase {String(phase).padStart(2,'0')} — {PHASE_NAMES[phase]}
                    </p>
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs border-collapse min-w-[500px]">
                        <thead>
                          <tr className="bg-slate-50">
                            <th className="text-left font-semibold text-slate-500 py-2 pr-4 pl-3 rounded-l-lg min-w-[140px]">User</th>
                            {items.map(item => (
                              <th key={item.id} className="font-medium text-slate-400 py-2 px-2 text-center max-w-[90px]">
                                <span className="block truncate max-w-[90px] font-semibold text-slate-600" title={item.title}>{item.title}</span>
                                <span className="font-normal text-slate-300 text-[10px]">{item.content_type}</span>
                              </th>
                            ))}
                            <th className="text-right font-semibold text-slate-500 py-2 pl-4 pr-3 rounded-r-lg">Done</th>
                          </tr>
                        </thead>
                        <tbody>
                          {progressData.users.map((user, ri) => {
                            const done = items.filter(i => getActivity(user.id, i.id) === 'completed').length
                            return (
                              <tr key={user.id} className={ri % 2 === 0 ? 'bg-white' : 'bg-slate-50/60'}>
                                <td className="py-2.5 pr-4 pl-3 font-medium text-slate-700">
                                  {user.full_name ?? '—'}
                                  {user.role && <span className="ml-1 text-[10px] text-slate-400">({user.role})</span>}
                                </td>
                                {items.map(item => (
                                  <td key={item.id} className="py-2.5 px-2 text-center">
                                    <StatusDot status={getActivity(user.id, item.id)} />
                                  </td>
                                ))}
                                <td className="py-2.5 pl-4 pr-3 text-right font-bold text-[#1F4E79]">
                                  {done}/{items.length}
                                </td>
                              </tr>
                            )
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                ))}
                <div className="flex gap-4 text-xs text-slate-400 pt-2 border-t border-slate-100">
                  <span><span className="text-green-500 mr-1">✓</span>Completed</span>
                  <span><span className="text-blue-400 mr-1">●</span>In Progress</span>
                  <span><span className="text-slate-200 mr-1">—</span>Not Started</span>
                </div>
              </div>
            )}
          </div>
        )}
        {modals}
      </div>
    )
  }

  // ── CLIENT LIST ────────────────────────────────────────────────────────────
  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-lg font-bold text-slate-800">Clients</h2>
          <p className="text-xs text-slate-400 mt-0.5">Companies · Projects · Users · Phase access · Pathways · Progress</p>
        </div>
        <button onClick={() => { setClientForm(emptyClientForm); setClientEditId(null); setClientError(null); setShowClientForm(true) }}
          className="bg-[#E8913A] text-white text-sm font-semibold px-4 py-2 rounded-xl hover:bg-[#d07e2e] transition-colors">
          + New Client
        </button>
      </div>

      {loading ? (
        <div className="space-y-3">{[1,2,3].map(n => <div key={n} className="h-16 bg-slate-100 rounded-xl animate-pulse" />)}</div>
      ) : clients.length === 0 ? (
        <div className="text-center py-16 bg-slate-50 rounded-2xl border border-slate-100">
          <p className="text-3xl mb-2">🏢</p>
          <p className="text-slate-500 text-sm font-semibold">No clients yet</p>
          <p className="text-slate-400 text-xs mt-1">Create a client to manage their projects, users, pathways and progress.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {clients.map(client => {
            const userCount = allUsers.filter(u => u.client_id === client.id).length
            return (
              <div key={client.id}
                className="bg-white border border-slate-100 rounded-2xl px-5 py-4 flex items-center gap-4 hover:shadow-sm transition-all cursor-pointer group"
                onClick={() => openClient(client)}>
                <div className="w-10 h-10 rounded-xl bg-[#1F4E79]/10 flex items-center justify-center font-bold text-[#1F4E79] shrink-0">
                  {client.name.charAt(0).toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="font-semibold text-slate-800 text-sm">{client.name}</p>
                    {!client.is_active && <span className="text-[10px] bg-slate-100 text-slate-400 px-2 py-0.5 rounded-full">Inactive</span>}
                  </div>
                  <p className="text-xs text-slate-400 mt-0.5">
                    {client.industry ? `${industryLabel(client.industry)} · ` : ''}{userCount} user{userCount !== 1 ? 's' : ''}
                    {client.contact_name ? ` · ${client.contact_name}` : ''}
                  </p>
                </div>
                <div className="flex gap-2 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity" onClick={e => e.stopPropagation()}>
                  <button onClick={() => { setClientForm({ name: client.name, industry: client.industry ?? '', contact_name: client.contact_name ?? '', contact_email: client.contact_email ?? '', notes: client.notes ?? '', is_active: client.is_active }); setClientEditId(client.id); setClientError(null); setShowClientForm(true) }}
                    className="text-xs text-[#1F4E79] hover:underline">Edit</button>
                  <button onClick={() => deleteClient(client.id)} className="text-xs text-red-400 hover:underline">Delete</button>
                </div>
                <svg className="w-4 h-4 text-slate-300 group-hover:text-[#1F4E79] transition-colors shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                </svg>
              </div>
            )
          })}
        </div>
      )}

      {modals}
    </div>
  )
}
