import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import ProjectTimeline from './ProjectTimeline'
import ProjectAudiences from './ProjectAudiences'
import ProjectTraining from './ProjectTraining'
import ProjectCoverage from './ProjectCoverage'

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
const ARTIFACT_META = {
  stakeholder_heatmap: { icon: '🔥', label: 'Stakeholder impact heat map', group: 'Stakeholder & impact' },
  stakeholder_map:     { icon: '🗂️', label: 'Stakeholder map',             group: 'Stakeholder & impact' },
  change_impact:       { icon: '🧭', label: 'Change impact assessment',    group: 'Stakeholder & impact' },
  timeline:            { icon: '📅', label: 'Timeline',                    group: 'Delivery & timeline' },
}
const artMeta = t => ARTIFACT_META[t] || { icon: '✦', label: t, group: 'Other' }
const LV_HEX = { vh: '#991B1B', h: '#DC2626', m: '#E8913A', l: '#16A34A', vl: '#86EFAC', none: '#E2E8F0' }
const LV_NAME = { vh: 'Very High', h: 'High', m: 'Medium', l: 'Low', vl: 'Very Low', none: 'None' }
// Friendly provenance label from the stored `source`.
function artSource(s) {
  if (!s) return { label: 'generated', cls: 'bg-slate-100 text-slate-500' }
  if (s === 'seed') return { label: 'from seed', cls: 'bg-emerald-100 text-emerald-700' }
  if (/\.(xlsx|xls|csv|pptx|pdf|docx?)$/i.test(s)) return { label: `uploaded · ${s}`, cls: 'bg-amber-100 text-amber-700' }
  return { label: s, cls: 'bg-purple-100 text-purple-700' }
}
const CONTENT_TYPES = [{ value: 'exercise', label: 'Exercise' }, { value: 'tool', label: 'Tool' }, { value: 'template', label: 'Template' }]
const TYPE_COLOR = { exercise: 'bg-blue-100 text-blue-700', tool: 'bg-green-100 text-green-700', template: 'bg-purple-100 text-purple-700' }
const emptyClientContentForm = { phase_number: 1, content_type: 'exercise', title: '', description: '', body: '', role: '', is_common: true, sort_order: 0 }

// ── helpers ────────────────────────────────────────────────────────────────────
function StatusDot({ status }) {
  if (status === 'completed')   return <span className="text-green-500 font-bold">✓</span>
  if (status === 'in_progress') return <span className="text-blue-400 text-[10px] font-bold leading-none">●</span>
  return <span className="text-slate-200">—</span>
}

// ── Main component ────────────────────────────────────────────────────────────

// Tab groups. `clientTab` still holds the LEAF key, so every `clientTab === 'content'`
// block below is untouched — this is navigation only, not a rewrite of the panels.
//
// Content and Templates sit together because they are the same shape: keyed by phase,
// global (client_id IS NULL) or client-specific, promotable between the two. Two names
// for one mental model was the reason for two tabs.
//
// Artifacts stays on its own deliberately. It is client programme data, not reusable
// material, and it is shrinking — the heat map already moved out to audiences, and
// gates and comms follow. Grouping it tidily now means regrouping when it is empty.
const TAB_GROUPS = [
  { key: 'projects', label: '📁 Projects',  leaves: [['projects',  'Projects']] },
  { key: 'pathway',  label: '🗺️ Pathway',   leaves: [['pathway',   'Pathway']],   clientOnly: true },
  { key: 'library',  label: '📚 Library',   leaves: [['content',   'Content'], ['templates', 'Templates']], clientOnly: true },
  { key: 'people',   label: '👥 People',    leaves: [['audiences', 'Audiences'], ['training', 'Training'], ['coverage', 'Coverage']] },
  { key: 'delivery', label: '📅 Delivery',  leaves: [['timeline',  'Timeline'],  ['progress',  'Progress']] },
  { key: 'artifacts',label: '✦ Artifacts',  leaves: [['artifacts', 'Artifacts']] },
]


// What each client page is FOR, in the user's language rather than the schema's.
// Kept as data next to TAB_GROUPS so a new tab has an obvious place to describe
// itself, and so the wording can be reviewed in one screenful instead of hunted
// through the JSX.
//
// Each entry: a bolded claim, then the one thing people get wrong about the page.
const TAB_INTRO = {
  projects:  ['The programmes running at {client}.',
    'A client is the organisation; a project is a change being delivered inside it. Almost everything else on these tabs hangs off a project, so this comes first.'],
  pathway:   ['The guided journey {client} works through.',
    'Phases unlock in sequence and carry the content, templates and activities their team sees. This is the client-facing experience, not an internal plan.'],
  content:   ['Reading and guidance, filed by phase.',
    'Items with no client are global and available to everyone; items here belong to {client} alone. You can promote a good one to global, or copy a global one down to tailor it.'],
  templates: ['Reusable documents, filed by phase.',
    'Same global-or-client rule as Content. Templates carry {{tokens}} that CORA fills from real programme data, so a drafted comms plan already has the right audiences and dates in it.'],
  audiences: ['The groups this change lands on.',
    'The foundation for four other things: the impact heat map is built from the domain ratings here, and comms, readiness gates and training all report against these groups. Get the headcount and the owner right and the rest follows.'],
  training:  ['What each group has to be able to do after go-live.',
    'The grid IS the training needs analysis — groups down the side, modules across, a mark where a need exists. An empty cell means not required, which is a real answer.'],
  coverage:  ['How far through the training each group is.',
    'Reported by each group\'s leader as a count and a date, not by naming individuals. A blank is never shown as 0% — the screen says whether nobody was asked, nobody answered, or the group has no size yet.'],
  timeline:  ['When everything happens.',
    'Swimlanes, phases, milestones and activities on one canvas. Drag to move or resize, click any bar to edit its dates, colour and percent complete.'],
  progress:  ['How {client} is actually tracking.',
    'Snapshots taken daily, so this answers "are we moving?" and not just "where are we?". The trend and any forecast come from that history.'],
  artifacts: ['Everything captured for {client}.',
    'Working artifacts the AI generated or that were uploaded. This store is shrinking by design — the heat map already moved to Audiences, and gates and comms follow as they get proper homes.'],
}

function TabIntro({ tab, client }) {
  const entry = TAB_INTRO[tab]
  if (!entry) return null
  const fill = t => t.replace(/\{client\}/g, client ?? 'this client')
  return (
    <div className="bg-[#1F4E79]/5 border border-[#1F4E79]/15 rounded-xl px-4 py-3 text-xs text-slate-600 leading-relaxed mb-5">
      <span className="font-semibold text-[#1F4E79]">{fill(entry[0])}</span>{' '}{fill(entry[1])}
    </div>
  )
}

export default function AdminClients({ allRoles = [], lockedClientId = null, initialClientId = null }) {
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
  const [inviteError,    setInviteError]    = useState({})   // { project_id: message }
  const [copiedToken,    setCopiedToken]    = useState(null)
  const [showProjectForm, setShowProjectForm] = useState(false)
  const [projectForm,    setProjectForm]    = useState(emptyProjectForm)
  const [projectEditId,  setProjectEditId]  = useState(null)
  const [projectSaving,  setProjectSaving]  = useState(false)
  const [projectError,   setProjectError]   = useState(null)

  // Pathway state
  const [pathwayPhase,   setPathwayPhase]   = useState(1)
  const [pathwayProject, setPathwayProject] = useState('')  // which project's pathway we're editing
  const [timelineProject, setTimelineProject] = useState('') // which project's timeline we're viewing
  const [audienceProject, setAudienceProject] = useState('') // which project's audiences we're editing
  const [trainingProject, setTrainingProject] = useState('') // and whose training matrix
  const [coverageProject, setCoverageProject] = useState('') // and whose coverage checks

  function initTab(key) {
    setClientTab(key)
    if (key === 'pathway' && !pathwayProject) {
      const pid = projects[0]?.id ?? ''
      setPathwayProject(pid)
      loadPathway(1, pid)
    }
    if (key === 'content')   loadContent(contentPhase, selectedClient.id)
    if (key === 'templates') loadClientTemplates(selectedClient.id)
    if (key === 'artifacts') loadArtifacts(selectedClient.id)
    if (key === 'timeline'  && !timelineProject) setTimelineProject(projects[0]?.id ?? '')
    if (key === 'audiences' && !audienceProject) setAudienceProject(projects[0]?.id ?? '')
    if (key === 'training'  && !trainingProject) setTrainingProject(projects[0]?.id ?? '')
    if (key === 'coverage'  && !coverageProject) setCoverageProject(projects[0]?.id ?? '')
    if (key === 'progress') {
      const pid = progressProject || projects[0]?.id || ''
      setProgressProject(pid)
      loadProgress(pid)
    }
  }

  const [progressProject, setProgressProject] = useState('') // which project's progress we're viewing
  const [phaseContent,   setPhaseContent]   = useState([])
  const [clientPathway,  setClientPathway]  = useState([])
  const [pathwaySaving,  setPathwaySaving]  = useState(false)
  const [showNotInPath,  setShowNotInPath]  = useState(false) // collapse the long "not in path" list

  // Progress state
  const [progressData,   setProgressData]   = useState({ users: [], items: [], activities: [] })

  // Content state (per-client authoring: custom items + inherited library)
  const [contentPhase,   setContentPhase]   = useState(1)
  const [ownContent,     setOwnContent]     = useState([])   // client_id = this client
  const [libContent,     setLibContent]     = useState([])   // client_id IS NULL (inherited)
  const [contentLoading, setContentLoading] = useState(false)
  const [showContentForm, setShowContentForm] = useState(false)
  const [contentForm,    setContentForm]    = useState(emptyClientContentForm)
  const [contentEditId,  setContentEditId]  = useState(null)
  const [contentSaving,  setContentSaving]  = useState(false)
  const [contentFormError, setContentFormError] = useState(null)

  // Templates state (per-client: custom + inherited global)
  const [ownTemplates,   setOwnTemplates]   = useState([])
  const [libTemplates,   setLibTemplates]   = useState([])
  const [tplLoading,     setTplLoading]     = useState(false)

  // Artifacts state (AI-captured / stored change_artifacts for this client)
  const [artifacts,      setArtifacts]      = useState([])
  const [artLoading,     setArtLoading]     = useState(false)
  const [viewArtifact,   setViewArtifact]   = useState(null)

  useEffect(() => { fetchClients(); fetchAllUsers(); fetchIndustries() }, [])

  // Scoped (Client Admin) mode: auto-open the one client and never show the list
  useEffect(() => {
    if (!lockedClientId) return
    supabase.from('clients').select('*').eq('id', lockedClientId).single()
      .then(({ data }) => { if (data) openClient(data) })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lockedClientId])

  // Deep-link (?client=<id>): auto-open that client on first load
  useEffect(() => {
    if (lockedClientId || !initialClientId) return
    supabase.from('clients').select('*').eq('id', initialClientId).single()
      .then(({ data }) => { if (data) openClient(data) })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialClientId])

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
    if (!email)   { setInviteError(prev => ({ ...prev, [projectId]: 'Enter an email address.' })); return }
    if (!f.role)  { setInviteError(prev => ({ ...prev, [projectId]: 'Select an Access Persona before creating the link.' })); return }
    setInviteError(prev => ({ ...prev, [projectId]: null }))
    setInviteBusy(projectId)
    const { error } = await supabase.from('project_invites').insert({
      project_id:      projectId,
      client_id:       selectedClient.id,
      email,
      full_name:       (f.full_name ?? '').trim() || null,
      role:            f.role,
      as_client_admin: !!f.as_client_admin,
      invited_by:      user.id,
    })
    setInviteBusy(null)
    if (error) { setInviteError(prev => ({ ...prev, [projectId]: error.message })); return }
    setInviteForm(prev => ({ ...prev, [projectId]: { email: '', full_name: '', role: '', as_client_admin: false } }))
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
      .select('id, full_name, role, is_client_admin')
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

  // Master-Admin only: promote/demote a member to Client Admin for this client.
  async function toggleClientAdmin(projectId, userId, makeAdmin) {
    const verb = makeAdmin ? 'grant Client Admin to' : 'remove Client Admin from'
    if (!window.confirm(`Are you sure you want to ${verb} this user? They'll ${makeAdmin ? 'be able to manage' : 'no longer manage'} their client's projects, users and invites.`)) return
    const { error } = await supabase
      .from('profiles')
      .update({ is_client_admin: makeAdmin, client_id: selectedClient.id })
      .eq('id', userId)
    if (error) { window.alert('Could not update: ' + error.message); return }
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

  // ── Pathway (per project) ────────────────────────────────────────────────────
  async function loadPathway(phase, projectId = pathwayProject) {
    setPathwayPhase(phase)
    setShowNotInPath(false) // always start minimized
    if (!projectId) { setPhaseContent([]); setClientPathway([]); return }
    const [{ data: content }, { data: pathway }] = await Promise.all([
      supabase.from('phase_content').select('id, title, content_type, role, industry').eq('phase_number', phase).order('sort_order'),
      supabase.from('project_pathways').select('*').eq('project_id', projectId).eq('phase_number', phase).order('pathway_step'),
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
    if (!pathwayProject) return
    setPathwaySaving(true)
    await supabase.from('project_pathways').delete().eq('project_id', pathwayProject).eq('phase_number', pathwayPhase)
    if (clientPathway.length > 0) {
      await supabase.from('project_pathways').insert(
        clientPathway.map(p => ({ project_id: pathwayProject, phase_number: pathwayPhase, content_id: p.content_id, pathway_step: p.pathway_step }))
      )
    }
    setPathwaySaving(false)
  }

  // ── Progress ─────────────────────────────────────────────────────────────────
  async function loadProgress(projectId = progressProject) {
    if (!projectId) { setProgressData({ users: [], items: [], activities: [] }); return }

    // Members of THIS project
    const { data: memberships } = await supabase.from('project_members').select('user_id').eq('project_id', projectId)
    const memberIds = [...new Set((memberships ?? []).map(m => m.user_id))]
    if (memberIds.length === 0) { setProgressData({ users: [], items: [], activities: [] }); return }
    const { data: memberProfiles } = await supabase.from('profiles').select('id, full_name, role').in('id', memberIds)
    const uniqueUsers = memberProfiles ?? []

    // Columns = this project's PATHWAY items only (the curated journey), per phase, in step order
    const { data: pp } = await supabase
      .from('project_pathways')
      .select('phase_number, pathway_step, phase_content(id, title, content_type, phase_number)')
      .eq('project_id', projectId)
      .order('phase_number').order('pathway_step')
    const items = (pp ?? []).map(r => ({ ...r.phase_content, pathway_step: r.pathway_step })).filter(i => i.id)

    const contentIds = items.map(i => i.id)
    let activities = []
    if (contentIds.length) {
      const { data } = await supabase.from('user_activities').select('user_id, content_id, status')
        .in('user_id', uniqueUsers.map(u => u.id)).in('content_id', contentIds)
      activities = data ?? []
    }
    setProgressData({ users: uniqueUsers, items, activities })
  }

  function getActivity(userId, contentId) {
    return progressData.activities.find(a => a.user_id === userId && a.content_id === contentId)?.status ?? null
  }

  // ── Content (per-client) ───────────────────────────────────────────────────────
  async function loadContent(phase = contentPhase, clientId = selectedClient?.id) {
    if (!clientId) return
    setContentPhase(phase)
    setContentLoading(true)
    const [{ data: own }, { data: lib }] = await Promise.all([
      supabase.from('phase_content').select('*').eq('phase_number', phase).eq('client_id', clientId).order('sort_order'),
      supabase.from('phase_content').select('*').eq('phase_number', phase).is('client_id', null).order('sort_order'),
    ])
    setOwnContent(own ?? [])
    setLibContent(lib ?? [])
    setContentLoading(false)
  }

  function openNewClientContent() {
    setContentForm({ ...emptyClientContentForm, phase_number: contentPhase })
    setContentEditId(null); setContentFormError(null); setShowContentForm(true)
  }

  function openEditClientContent(item) {
    setContentForm({
      phase_number: item.phase_number, content_type: item.content_type, title: item.title,
      description: item.description ?? '', body: item.body ?? '', role: item.role ?? '',
      is_common: item.is_common ?? true, sort_order: item.sort_order ?? 0,
    })
    setContentEditId(item.id); setContentFormError(null); setShowContentForm(true)
  }

  async function saveClientContent() {
    if (!contentForm.title.trim()) { setContentFormError('Title is required'); return }
    setContentSaving(true)
    const payload = {
      ...contentForm, title: contentForm.title.trim(),
      description: contentForm.description || null, body: contentForm.body || null,
      role: contentForm.role || null, client_id: selectedClient.id,
    }
    let error
    if (contentEditId) ({ error } = await supabase.from('phase_content').update(payload).eq('id', contentEditId))
    else               ({ error } = await supabase.from('phase_content').insert(payload))
    setContentSaving(false)
    if (error) { setContentFormError(error.message); return }
    setShowContentForm(false)
    loadContent()
  }

  // Master-Admin only: promote a client item into the shared library (reusable for all).
  async function promoteClientContent(item) {
    if (!window.confirm(`Promote “${item.title}” to the shared library? Every current and future customer inherits it.`)) return
    const { error } = await supabase.from('phase_content').update({ client_id: null }).eq('id', item.id)
    if (error) { window.alert(error.message); return }
    loadContent()
  }

  // Copy an inherited library item into this client as an editable custom version.
  async function cloneLibToClient(item) {
    const { id, created_at, updated_at, ...rest } = item
    const { error } = await supabase.from('phase_content').insert({ ...rest, client_id: selectedClient.id })
    if (error) { window.alert(error.message); return }
    loadContent()
  }

  async function deleteClientContent(id) {
    if (!window.confirm('Delete this custom item? (The shared-library version, if any, is unaffected.)')) return
    await supabase.from('phase_content').delete().eq('id', id)
    loadContent()
  }

  // ── Templates (per-client) ─────────────────────────────────────────────────────
  async function loadClientTemplates(clientId = selectedClient?.id) {
    if (!clientId) return
    setTplLoading(true)
    const [{ data: own }, { data: lib }] = await Promise.all([
      supabase.from('templates').select('*').eq('client_id', clientId).order('phase_number').order('sort_order'),
      supabase.from('templates').select('*').is('client_id', null).order('phase_number').order('sort_order'),
    ])
    setOwnTemplates(own ?? [])
    setLibTemplates(lib ?? [])
    setTplLoading(false)
  }

  async function cloneTemplateToClient(t) {
    const { id, created_at, updated_at, ...rest } = t
    const { error } = await supabase.from('templates').insert({ ...rest, client_id: selectedClient.id, title: `${t.title} (${selectedClient.name})` })
    if (error) { window.alert(error.message); return }
    loadClientTemplates()
  }

  async function promoteClientTemplate(t) {
    if (!window.confirm(`Promote “${t.title}” to the global Templates library? Every current and future customer can use it.`)) return
    const { error } = await supabase.from('templates').update({ client_id: null }).eq('id', t.id)
    if (error) { window.alert(error.message); return }
    loadClientTemplates()
  }

  async function deleteClientTemplate(id) {
    if (!window.confirm('Delete this custom template? User responses to it will also be removed.')) return
    await supabase.from('templates').delete().eq('id', id)
    loadClientTemplates()
  }

  // ── Artifacts (per-client) ───────────────────────────────────────────────────
  async function loadArtifacts(clientId = selectedClient?.id) {
    if (!clientId) return
    setArtLoading(true)
    const { data } = await supabase.from('change_artifacts')
      .select('*').eq('client_id', clientId).order('type').order('version', { ascending: false })
    setArtifacts(data ?? [])
    setArtLoading(false)
  }

  async function deleteArtifact(a) {
    if (!window.confirm(`Delete "${a.title}" (v${a.version})? This can't be undone.`)) return
    await supabase.from('change_artifacts').delete().eq('id', a.id)
    setViewArtifact(null)
    loadArtifacts()
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

      {/* ── Artifact viewer modal ── */}
      {viewArtifact && (() => {
        const a = viewArtifact, meta = artMeta(a.type), isHeat = (a.data?.rows ?? []).some(r => r.cells)
        return (
          <>
            <div className="fixed inset-0 bg-black/40 z-40" onClick={() => setViewArtifact(null)} />
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4 pointer-events-none">
              <div className="bg-white rounded-2xl shadow-2xl pointer-events-auto w-full max-w-2xl max-h-[88vh] overflow-y-auto">
                <div className="px-6 py-5 border-b border-slate-100 flex items-center justify-between sticky top-0 bg-white">
                  <div className="flex items-center gap-2">
                    <span className="text-lg">{meta.icon}</span>
                    <div>
                      <h3 className="font-bold text-slate-800 leading-tight">{a.title}</h3>
                      <p className="text-[11px] text-slate-400">v{a.version} · current · {artSource(a.source).label}</p>
                    </div>
                  </div>
                  <button onClick={() => setViewArtifact(null)} className="w-7 h-7 rounded-full bg-slate-100 flex items-center justify-center text-slate-500 text-xs">✕</button>
                </div>
                <div className="px-6 py-5">
                  {isHeat ? (
                    <div className="overflow-x-auto">
                      <table className="border-separate" style={{ borderSpacing: '6px' }}>
                        <thead><tr><th></th>{(a.data.cols ?? []).map(c => <th key={c} className="text-[11px] font-semibold text-slate-500 px-1 text-center whitespace-nowrap">{c}</th>)}</tr></thead>
                        <tbody>
                          {a.data.rows.map((r, i) => (
                            <tr key={i}>
                              <td className="text-[12px] font-semibold text-slate-700 pr-2 text-right whitespace-nowrap">{r.label}</td>
                              {(r.cells ?? []).map((lv, j) => (
                                <td key={j} className="text-center"><span title={LV_NAME[lv] ?? lv} className="inline-block w-[18px] h-[18px] rounded-full align-middle" style={{ background: LV_HEX[lv] ?? LV_HEX.none, boxShadow: '0 1px 3px rgba(0,0,0,.18)' }} /></td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      <div className="flex flex-wrap gap-2.5 mt-3 text-[10.5px] text-slate-400">
                        {['vh', 'h', 'm', 'l', 'vl', 'none'].map(k => <span key={k} className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full" style={{ background: LV_HEX[k] }} />{LV_NAME[k]}</span>)}
                      </div>
                    </div>
                  ) : (
                    <pre className="text-xs text-slate-600 bg-slate-50 border border-slate-100 rounded-xl p-4 overflow-x-auto whitespace-pre-wrap">{JSON.stringify(a.data, null, 2)}</pre>
                  )}
                  {a.data?.commentary && (
                    <div className="mt-4 rounded-xl bg-slate-50 border border-slate-200 border-l-[3px] border-l-[#1F4E79] px-4 py-3.5">
                      <p className="text-[10px] font-bold text-[#E8913A] uppercase tracking-widest mb-2">✦ AI insight</p>
                      <p className="text-[13.5px] leading-relaxed text-slate-600">{a.data.commentary.replace(/\*\*/g, '')}</p>
                    </div>
                  )}
                </div>
                <div className="px-6 py-4 border-t border-slate-100 flex justify-end gap-3">
                  {!lockedClientId && <button onClick={() => deleteArtifact(a)} className="text-sm text-red-400 hover:text-red-600 px-4 py-2">Delete</button>}
                  <button onClick={() => setViewArtifact(null)} className="text-sm text-slate-500 px-4 py-2">Close</button>
                </div>
              </div>
            </div>
          </>
        )
      })()}

      {/* ── Client content form modal ── */}
      {showContentForm && (
        <>
          <div className="fixed inset-0 bg-black/40 z-40" onClick={() => setShowContentForm(false)} />
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 pointer-events-none">
            <div className="bg-white rounded-2xl shadow-2xl pointer-events-auto w-full max-w-lg">
              <div className="px-6 py-5 border-b border-slate-100 flex items-center justify-between">
                <h3 className="font-bold text-slate-800">{contentEditId ? 'Edit Content' : 'Add Content'} · {selectedClient?.name}</h3>
                <button onClick={() => setShowContentForm(false)} className="w-7 h-7 rounded-full bg-slate-100 hover:bg-slate-200 flex items-center justify-center text-slate-500 text-xs">✕</button>
              </div>
              <div className="px-6 py-5 space-y-4">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-slate-600 mb-1">Phase</label>
                    <select value={contentForm.phase_number} onChange={e => setContentForm({...contentForm, phase_number: Number(e.target.value)})}
                      className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#1F4E79] bg-white">
                      {PHASES.map(p => <option key={p} value={p}>{String(p).padStart(2,'0')} {PHASE_NAMES[p]}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-600 mb-1">Type</label>
                    <select value={contentForm.content_type} onChange={e => setContentForm({...contentForm, content_type: e.target.value})}
                      className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#1F4E79] bg-white">
                      {CONTENT_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                    </select>
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">Role <span className="text-slate-400 font-normal">(blank = all roles)</span></label>
                  <select value={contentForm.role} onChange={e => setContentForm({...contentForm, role: e.target.value})}
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#1F4E79] bg-white">
                    <option value="">All roles</option>
                    {allRoles.map(r => <option key={r.code} value={r.code}>{r.label}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">Title *</label>
                  <input value={contentForm.title} onChange={e => setContentForm({...contentForm, title: e.target.value})}
                    placeholder="e.g. Stakeholder Map — bespoke"
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#1F4E79]" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">Description</label>
                  <textarea value={contentForm.description} onChange={e => setContentForm({...contentForm, description: e.target.value})}
                    rows={2} placeholder="What does this help the user achieve?"
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm resize-none focus:outline-none focus:border-[#1F4E79]" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">Body <span className="text-slate-400 font-normal">(optional — shown in the user's drawer)</span></label>
                  <textarea value={contentForm.body} onChange={e => setContentForm({...contentForm, body: e.target.value})}
                    rows={5} placeholder="Use ## headings, - bullets, **bold**."
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm resize-none focus:outline-none focus:border-[#1F4E79] font-mono" />
                </div>
                <div className="flex items-center justify-between bg-slate-50 rounded-xl px-4 py-3 border border-slate-100">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input type="checkbox" checked={contentForm.is_common} onChange={e => setContentForm({...contentForm, is_common: e.target.checked})} className="w-4 h-4 accent-[#1F4E79]" />
                    <span className="text-sm text-slate-700">Common <span className="text-slate-400 text-xs">(shown to all roles)</span></span>
                  </label>
                  <div className="flex items-center gap-2">
                    <label className="text-xs text-slate-500">Order</label>
                    <input type="number" value={contentForm.sort_order} onChange={e => setContentForm({...contentForm, sort_order: Number(e.target.value)})}
                      className="w-16 border border-slate-200 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:border-[#1F4E79] bg-white" />
                  </div>
                </div>
                <p className="text-[10px] text-slate-400">
                  Saved as <strong>custom for {selectedClient?.name}</strong>.{!lockedClientId && ' Promote it to the shared library later to reuse it for future customers.'}
                </p>
                {contentFormError && <p className="text-sm text-red-500">{contentFormError}</p>}
              </div>
              <div className="px-6 py-4 border-t border-slate-100 flex justify-end gap-3">
                <button onClick={() => setShowContentForm(false)} className="text-sm text-slate-500 px-4 py-2">Cancel</button>
                <button onClick={saveClientContent} disabled={contentSaving}
                  className="bg-[#1F4E79] text-white text-sm font-semibold px-6 py-2 rounded-lg hover:bg-[#163a5c] transition-colors disabled:opacity-60">
                  {contentSaving ? 'Saving…' : contentEditId ? 'Save Changes' : 'Add Content'}
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
          {!lockedClientId && <>
            <button onClick={() => setSelectedClient(null)} className="text-sm text-slate-500 hover:text-slate-700">← All Clients</button>
            <span className="text-slate-300">/</span>
          </>}
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
          {!lockedClientId && (
            <div className="ml-auto flex gap-2">
              <button onClick={() => { setClientForm({ name: selectedClient.name, industry: selectedClient.industry ?? '', contact_name: selectedClient.contact_name ?? '', contact_email: selectedClient.contact_email ?? '', notes: selectedClient.notes ?? '', is_active: selectedClient.is_active }); setClientEditId(selectedClient.id); setShowClientForm(true) }}
                className="text-xs text-[#1F4E79] border border-[#1F4E79]/30 px-3 py-1.5 rounded-lg hover:bg-[#1F4E79]/5 transition-colors">
                Edit Client
              </button>
            </div>
          )}
        </div>

        {/* Tabs — group row, then sub-tabs for whichever group is open */}
        {(() => {
          const groups = TAB_GROUPS.filter(g => !(g.clientOnly && lockedClientId))
          const openGroup = groups.find(g => g.leaves.some(([k]) => k === clientTab)) ?? groups[0]
          return (
            <>
              <div className="flex gap-1 mb-0 border-b border-slate-100 flex-wrap">
                {groups.map(g => (
                  <button key={g.key}
                    // Opening a group lands on its first leaf. Returning to a group you
                    // were already in keeps you where you were.
                    onClick={() => initTab(g.leaves.some(([k]) => k === clientTab) ? clientTab : g.leaves[0][0])}
                    className={`px-4 py-2 text-sm font-semibold border-b-2 transition-colors -mb-px ${
                      openGroup?.key === g.key ? 'border-[#1F4E79] text-[#1F4E79]' : 'border-transparent text-slate-500 hover:text-slate-700'
                    }`}>
                    {g.label}
                  </button>
                ))}
              </div>
              {/* A single-leaf group has nothing to choose, so no second row is drawn. */}
              {openGroup && openGroup.leaves.length > 1 && (
                <div className="flex gap-1 mt-3">
                  {openGroup.leaves.map(([key, label]) => (
                    <button key={key} onClick={() => initTab(key)}
                      className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors ${
                        clientTab === key ? 'bg-[#1F4E79] text-white' : 'bg-slate-100 text-slate-500 hover:text-slate-700'
                      }`}>
                      {label}
                    </button>
                  ))}
                </div>
              )}
            </>
          )
        })()}
        <div className="mb-5" />
        <TabIntro tab={clientTab} client={selectedClient?.name} />

        {/* ── PROJECTS TAB ── */}
        {clientTab === 'projects' && (
          <div className="space-y-4">
            {/* How-to hint: a client alone doesn't onboard users */}
            <div className="bg-[#1F4E79]/5 border border-[#1F4E79]/15 rounded-xl px-4 py-3 text-xs text-slate-600 leading-relaxed">
              <span className="font-semibold text-[#1F4E79]">Adding users — 3 steps:</span> ① this client is the company.
              ② Create a <strong>project</strong> below and unlock its phases. ③ In a project, open <strong>Members</strong> →
              <strong> Invite someone new</strong> to generate a signup link to share (or <strong>Assign</strong> an existing user).
              People get access only after they register through the invite link.
            </div>
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
                                  {u.is_client_admin && (
                                    <span className="text-[9px] font-bold bg-[#1F4E79]/10 text-[#1F4E79] px-1.5 py-0.5 rounded-full tracking-wide">CLIENT ADMIN</span>
                                  )}
                                  {/* Master-Admin only: promote / demote */}
                                  {!lockedClientId && (
                                    <button
                                      onClick={() => toggleClientAdmin(project.id, u.id, !u.is_client_admin)}
                                      title={u.is_client_admin ? 'Remove Client Admin' : 'Make Client Admin'}
                                      className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-md leading-none ${u.is_client_admin ? 'text-amber-500 hover:text-amber-700' : 'text-[#1F4E79]/60 hover:text-[#1F4E79]'}`}>
                                      {u.is_client_admin ? '− Admin' : '+ Admin'}
                                    </button>
                                  )}
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
                                <option value="">Access Persona * …</option>
                                {allRoles.map(r => <option key={r.code} value={r.code}>{r.label}</option>)}
                              </select>
                              <button onClick={() => createInvite(project.id)} disabled={inviteBusy === project.id}
                                className="bg-[#E8913A] text-white text-xs font-semibold px-3 py-1.5 rounded-lg hover:bg-[#d07e2e] transition-colors disabled:opacity-60">
                                {inviteBusy === project.id ? 'Creating…' : '+ Invite link'}
                              </button>
                            </div>
                            {/* Master-Admin only: invite straight in as a Client Admin */}
                            {!lockedClientId && (
                              <label className="flex items-center gap-1.5 mt-2 text-[11px] text-slate-600 cursor-pointer select-none">
                                <input type="checkbox"
                                  checked={!!inviteForm[project.id]?.as_client_admin}
                                  onChange={e => setInviteForm(prev => ({ ...prev, [project.id]: { ...prev[project.id], as_client_admin: e.target.checked } }))}
                                  className="rounded border-slate-300" />
                                Invite as <strong>Client Admin</strong> — they'll manage this client's projects, users &amp; invites once they accept.
                              </label>
                            )}
                            {inviteError[project.id] && (
                              <p className="text-[11px] text-red-500 mt-1.5 font-medium">⚠ {inviteError[project.id]}</p>
                            )}
                            <p className="text-[10px] text-slate-400 mt-1.5">Creates a signup link you can share. They join this project when they register. An <strong>Access Persona</strong> is required so they get the right content (onboarding is skipped for invited users). Re-copy any time to resend.</p>
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
          projects.length === 0 ? (
            <div className="text-center py-10 bg-slate-50 rounded-2xl border border-slate-100">
              <p className="text-slate-400 text-sm">No projects yet.</p>
              <p className="text-slate-300 text-xs mt-1">Create a project in the Projects tab first — pathways are configured per project.</p>
            </div>
          ) : (
          <div>
            <p className="text-xs text-slate-500 mb-4">
              Configure the guided pathway for each phase <strong>of this project</strong>. The steps you set appear as the primary journey for its members.
            </p>

            {/* Project selector */}
            <div className="mb-4">
              <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">Project</label>
              <select value={pathwayProject}
                onChange={e => { setPathwayProject(e.target.value); loadPathway(pathwayPhase, e.target.value) }}
                className="border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:border-[#1F4E79] min-w-[220px]">
                {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>

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

            {/* Content list — split so the curated pathway stays front-and-centre and
                everything else is tucked into a collapsed "Not in path" group. */}
            {(() => {
              const rowFor = item => (
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
              )
              const inPath    = phaseContent.filter(i => getStep(i.id) !== '')
                                            .sort((a, b) => Number(getStep(a.id)) - Number(getStep(b.id)))
              const notInPath = phaseContent.filter(i => getStep(i.id) === '')
              return (
                <div className="mb-4">
                  {/* In-path items (the curated journey) */}
                  {inPath.length > 0 && (
                    <div className="space-y-2 mb-3">
                      <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">In path · {inPath.length}</p>
                      {inPath.map(rowFor)}
                    </div>
                  )}

                  {/* Collapsed "not in path" group — click to expand and add more */}
                  <button type="button" onClick={() => setShowNotInPath(v => !v)}
                    className="w-full flex items-center justify-between bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 hover:bg-slate-100 transition-colors">
                    <span className="text-sm font-semibold text-slate-600">
                      {showNotInPath ? '▾' : '▸'} Not in path · {notInPath.length}
                    </span>
                    <span className="text-[11px] text-slate-400">{showNotInPath ? 'Hide' : 'Add content to path'}</span>
                  </button>
                  {showNotInPath && (
                    <div className="space-y-2 mt-2">
                      {notInPath.length === 0
                        ? <p className="text-xs text-slate-400 px-1 py-2">Everything in this phase is already in the path.</p>
                        : notInPath.map(rowFor)}
                    </div>
                  )}
                </div>
              )
            })()}

            <button onClick={savePathway} disabled={pathwaySaving}
              className="bg-[#1F4E79] text-white text-sm font-semibold px-6 py-2.5 rounded-xl hover:bg-[#163a5c] transition-colors disabled:opacity-60">
              {pathwaySaving ? 'Saving…' : '✓ Save Phase ' + pathwayPhase + ' Pathway'}
            </button>
          </div>
          )
        )}

        {/* ── CONTENT TAB ── */}
        {clientTab === 'content' && (
          <div>
            <div className="bg-[#1F4E79]/5 border border-[#1F4E79]/15 rounded-xl px-4 py-3 text-xs text-slate-600 leading-relaxed mb-5">
              <span className="font-semibold text-[#1F4E79]">Content for {selectedClient.name}.</span>{' '}
              <strong>Custom</strong> items belong to this client only. <strong>Inherited</strong> items come from the shared
              library and are available to every customer — clone one to make a client-specific version.
              {!lockedClientId && ' Promote a custom item to the library to reuse it for future customers.'}
            </div>

            {/* Phase selector */}
            <div className="flex gap-2 mb-5 flex-wrap">
              {PHASES.map(ph => (
                <button key={ph} onClick={() => loadContent(ph)}
                  className={`px-3 py-1.5 rounded-lg text-sm font-semibold transition-all ${
                    contentPhase === ph ? 'bg-[#1F4E79] text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                  }`}>
                  {PHASE_ICONS[ph]} {String(ph).padStart(2,'0')} {PHASE_NAMES[ph]}
                </button>
              ))}
            </div>

            {contentLoading ? (
              <p className="text-sm text-slate-400">Loading…</p>
            ) : (
              <div className="space-y-6">
                {/* Custom for this client */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                      🏢 Custom for {selectedClient.name} · {ownContent.length}
                    </p>
                    <button onClick={openNewClientContent}
                      className="bg-[#E8913A] text-white text-xs font-semibold px-3 py-1.5 rounded-lg hover:bg-[#d07e2e] transition-colors">
                      + Add Content
                    </button>
                  </div>
                  {ownContent.length === 0 ? (
                    <div className="text-center py-8 bg-slate-50 rounded-xl border border-slate-100">
                      <p className="text-slate-400 text-sm">No custom content for this phase yet.</p>
                      <p className="text-slate-300 text-xs mt-1">Add a bespoke item, or clone one from the library below.</p>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {ownContent.map(item => (
                        <div key={item.id} className="flex items-start gap-4 bg-white border border-[#1F4E79]/20 rounded-xl p-4">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-1">
                              <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${TYPE_COLOR[item.content_type] ?? 'bg-slate-100 text-slate-600'}`}>{item.content_type}</span>
                              <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-[#1F4E79]/10 text-[#1F4E79]">🏢 Custom</span>
                              {item.role && <span className="text-[10px] text-slate-400">· {item.role.toUpperCase()}</span>}
                            </div>
                            <p className="font-medium text-slate-800 text-sm">{item.title}</p>
                            {item.description && <p className="text-xs text-slate-500 mt-0.5 leading-relaxed line-clamp-2">{item.description}</p>}
                          </div>
                          <div className="flex flex-col items-end gap-1.5 shrink-0">
                            <div className="flex gap-2">
                              <button onClick={() => openEditClientContent(item)} className="text-xs text-[#1F4E79] hover:underline">Edit</button>
                              <button onClick={() => deleteClientContent(item.id)} className="text-xs text-red-400 hover:underline">Delete</button>
                            </div>
                            {!lockedClientId && (
                              <button onClick={() => promoteClientContent(item)} className="text-[11px] text-emerald-600 hover:underline whitespace-nowrap">↑ Promote to library</button>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Inherited from library */}
                <div>
                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2">🌐 Inherited from library · {libContent.length}</p>
                  {libContent.length === 0 ? (
                    <p className="text-xs text-slate-400 px-1">No shared-library content for this phase.</p>
                  ) : (
                    <div className="space-y-2">
                      {libContent.map(item => (
                        <div key={item.id} className="flex items-start gap-4 bg-slate-50 border border-slate-100 rounded-xl p-4">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-1">
                              <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${TYPE_COLOR[item.content_type] ?? 'bg-slate-100 text-slate-600'}`}>{item.content_type}</span>
                              <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700">🌐 Library</span>
                              {item.industry && <span className="text-[10px] text-slate-400">{item.industry}</span>}
                              {item.role && <span className="text-[10px] text-slate-400">· {item.role.toUpperCase()}</span>}
                            </div>
                            <p className="font-medium text-slate-700 text-sm">{item.title}</p>
                            {item.description && <p className="text-xs text-slate-500 mt-0.5 leading-relaxed line-clamp-2">{item.description}</p>}
                          </div>
                          <div className="shrink-0">
                            <button onClick={() => cloneLibToClient(item)} className="text-[11px] text-[#1F4E79] hover:underline whitespace-nowrap">⎘ Clone to customise</button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── TEMPLATES TAB ── */}
        {clientTab === 'templates' && (
          <div>
            <div className="bg-[#1F4E79]/5 border border-[#1F4E79]/15 rounded-xl px-4 py-3 text-xs text-slate-600 leading-relaxed mb-5">
              <span className="font-semibold text-[#1F4E79]">Templates for {selectedClient.name}.</span>{' '}
              <strong>Custom</strong> templates belong to this client. <strong>Global</strong> templates are shared with every
              customer — clone one to make a client-specific version, or promote a custom template to the global library.
              Full template building (columns) lives in <strong>Platform Admin → Templates</strong>.
            </div>

            {tplLoading ? (
              <p className="text-sm text-slate-400">Loading…</p>
            ) : (
              <div className="space-y-6">
                {/* Custom for this client */}
                <div>
                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2">🏢 Custom for {selectedClient.name} · {ownTemplates.length}</p>
                  {ownTemplates.length === 0 ? (
                    <div className="text-center py-8 bg-slate-50 rounded-xl border border-slate-100">
                      <p className="text-slate-400 text-sm">No custom templates yet.</p>
                      <p className="text-slate-300 text-xs mt-1">Clone one from the global library below to tailor it.</p>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {ownTemplates.map(t => (
                        <div key={t.id} className={`bg-white border border-[#1F4E79]/20 rounded-xl p-4 ${!t.is_active ? 'opacity-50' : ''}`}>
                          <div className="flex items-start gap-4">
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 mb-1 flex-wrap">
                                <p className="font-semibold text-slate-800 text-sm">{t.title}</p>
                                <span className="text-[10px] font-semibold bg-purple-100 text-purple-700 px-2 py-0.5 rounded-full">Phase {String(t.phase_number).padStart(2,'0')}</span>
                                <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-[#1F4E79]/10 text-[#1F4E79]">🏢 Custom</span>
                              </div>
                              {t.description && <p className="text-xs text-slate-500 mb-1">{t.description}</p>}
                              <div className="flex flex-wrap gap-1.5 mt-1.5">
                                {(t.columns ?? []).map((col, i) => (
                                  <span key={i} className="text-[10px] font-medium bg-slate-50 border border-slate-200 text-slate-600 px-2 py-0.5 rounded-full">{col.label}<span className="text-slate-400 ml-1">({col.type})</span></span>
                                ))}
                              </div>
                            </div>
                            <div className="flex flex-col items-end gap-1.5 shrink-0">
                              <button onClick={() => deleteClientTemplate(t.id)} className="text-xs text-red-400 hover:underline">Delete</button>
                              {!lockedClientId && <button onClick={() => promoteClientTemplate(t)} className="text-[11px] text-emerald-600 hover:underline whitespace-nowrap">↑ Promote to library</button>}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Inherited global */}
                <div>
                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2">🌐 Global library · {libTemplates.length}</p>
                  {libTemplates.length === 0 ? (
                    <p className="text-xs text-slate-400 px-1">No global templates yet.</p>
                  ) : (
                    <div className="space-y-2">
                      {libTemplates.map(t => (
                        <div key={t.id} className={`bg-slate-50 border border-slate-100 rounded-xl p-4 ${!t.is_active ? 'opacity-50' : ''}`}>
                          <div className="flex items-start gap-4">
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 mb-1 flex-wrap">
                                <p className="font-semibold text-slate-700 text-sm">{t.title}</p>
                                <span className="text-[10px] font-semibold bg-purple-100 text-purple-700 px-2 py-0.5 rounded-full">Phase {String(t.phase_number).padStart(2,'0')}</span>
                                <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700">🌐 Global</span>
                              </div>
                              {t.description && <p className="text-xs text-slate-500 mb-1">{t.description}</p>}
                              <div className="flex flex-wrap gap-1.5 mt-1.5">
                                {(t.columns ?? []).map((col, i) => (
                                  <span key={i} className="text-[10px] font-medium bg-white border border-slate-200 text-slate-600 px-2 py-0.5 rounded-full">{col.label}<span className="text-slate-400 ml-1">({col.type})</span></span>
                                ))}
                              </div>
                            </div>
                            <div className="shrink-0">
                              <button onClick={() => cloneTemplateToClient(t)} className="text-[11px] text-[#1F4E79] hover:underline whitespace-nowrap">⎘ Clone to customise</button>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── ARTIFACTS TAB ── */}
        {clientTab === 'artifacts' && (
          <div>
            {artLoading ? (
              <p className="text-sm text-slate-400">Loading…</p>
            ) : artifacts.filter(a => a.is_current).length === 0 ? (
              <div className="text-center py-12 bg-slate-50 rounded-2xl border border-slate-100">
                <p className="text-3xl mb-2">✦</p>
                <p className="text-slate-400 text-sm">No artifacts captured yet.</p>
                <p className="text-slate-300 text-xs mt-1">Ask the AI to add a heat map or stakeholder map for this client, and it'll show up here.</p>
              </div>
            ) : (() => {
              const current = artifacts.filter(a => a.is_current)
              const historyCount = t => artifacts.filter(a => a.type === t && !a.is_current).length
              const groups = [...new Set(current.map(a => artMeta(a.type).group))]
              const card = a => {
                const meta = artMeta(a.type); const src = artSource(a.source)
                const cells = (a.data?.rows ?? []).flatMap(r => r.cells ?? []).slice(0, 12)
                return (
                  <div key={a.id} className="bg-white border border-slate-100 rounded-2xl p-4 flex flex-col gap-2.5">
                    <div className="flex items-start gap-3">
                      <div className="w-9 h-9 rounded-xl bg-[#1F4E79]/10 flex items-center justify-center text-lg shrink-0">{meta.icon}</div>
                      <div className="min-w-0 flex-1">
                        <p className="font-semibold text-slate-800 text-sm leading-tight">{a.title}</p>
                        <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                          <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-[#1F4E79]/10 text-[#1F4E79]">v{a.version} · current</span>
                          <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${src.cls}`}>{src.label}</span>
                        </div>
                      </div>
                    </div>
                    {cells.length > 0 && (
                      <div className="grid gap-1.5 py-1" style={{ gridTemplateColumns: 'repeat(4, 14px)' }}>
                        {cells.map((lv, i) => <span key={i} className="w-3.5 h-3.5 rounded-full" style={{ background: LV_HEX[lv] ?? LV_HEX.none }} />)}
                      </div>
                    )}
                    {a.data?.commentary && <p className="text-xs text-slate-500 leading-relaxed line-clamp-2">{a.data.commentary.replace(/\*\*/g, '')}</p>}
                    <div className="flex items-center gap-3 pt-2.5 mt-auto border-t border-slate-100">
                      <button onClick={() => setViewArtifact(a)} className="text-xs font-semibold text-[#1F4E79] hover:underline">View</button>
                      {historyCount(a.type) > 0 && <span className="text-[11px] text-slate-400">History ({historyCount(a.type)})</span>}
                      {!lockedClientId && <button onClick={() => deleteArtifact(a)} className="text-xs text-red-400 hover:underline ml-auto">Delete</button>}
                    </div>
                  </div>
                )
              }
              return (
                <div className="space-y-6">
                  {groups.map(g => (
                    <div key={g}>
                      <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2.5">{g}</p>
                      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                        {current.filter(a => artMeta(a.type).group === g).map(card)}
                      </div>
                    </div>
                  ))}
                </div>
              )
            })()}
          </div>
        )}

        {/* ── TIMELINE TAB ── */}
        {clientTab === 'audiences' && (
          projects.length === 0 ? (
            <div className="text-center py-10 bg-slate-50 rounded-2xl border border-slate-100">
              <p className="text-slate-400 text-sm">No projects yet.</p>
              <p className="text-slate-300 text-xs mt-1">Create a project first — audiences are per project, because the same organisation splits differently for each change.</p>
            </div>
          ) : (
          <div>
            <div className="mb-4">
              <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">Project</label>
              <select value={audienceProject} onChange={e => setAudienceProject(e.target.value)}
                className="border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:border-[#1F4E79] min-w-[220px]">
                {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
            {audienceProject && (
              <ProjectAudiences project={projects.find(p => p.id === audienceProject) ?? projects[0]} />
            )}
          </div>
          )
        )}

        {clientTab === 'training' && (
          projects.length === 0 ? (
            <div className="text-center py-10 bg-slate-50 rounded-2xl border border-slate-100">
              <p className="text-slate-400 text-sm">No projects yet.</p>
              <p className="text-slate-300 text-xs mt-1">Create a project first — training needs are per project.</p>
            </div>
          ) : (
          <div>
            <div className="mb-4">
              <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">Project</label>
              <select value={trainingProject} onChange={e => setTrainingProject(e.target.value)}
                className="border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:border-[#1F4E79] min-w-[220px]">
                {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
            {trainingProject && (
              <ProjectTraining project={projects.find(p => p.id === trainingProject) ?? projects[0]} />
            )}
          </div>
          )
        )}

        {clientTab === 'coverage' && (
          projects.length === 0 ? (
            <div className="text-center py-10 bg-slate-50 rounded-2xl border border-slate-100">
              <p className="text-slate-400 text-sm">No projects yet.</p>
              <p className="text-slate-300 text-xs mt-1">Create a project first — coverage is reported per project.</p>
            </div>
          ) : (
          <div>
            <div className="mb-4">
              <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">Project</label>
              <select value={coverageProject} onChange={e => setCoverageProject(e.target.value)}
                className="border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:border-[#1F4E79] min-w-[220px]">
                {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
            {coverageProject && (
              <ProjectCoverage project={projects.find(p => p.id === coverageProject) ?? projects[0]} />
            )}
          </div>
          )
        )}

        {clientTab === 'timeline' && (
          projects.length === 0 ? (
            <div className="text-center py-10 bg-slate-50 rounded-2xl border border-slate-100">
              <p className="text-slate-400 text-sm">No projects yet.</p>
              <p className="text-slate-300 text-xs mt-1">Create a project first — the timeline is per project.</p>
            </div>
          ) : (
          <div>
            <div className="mb-4">
              <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">Project</label>
              <select value={timelineProject} onChange={e => setTimelineProject(e.target.value)}
                className="border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:border-[#1F4E79] min-w-[220px]">
                {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
            {timelineProject && (
              <ProjectTimeline project={projects.find(p => p.id === timelineProject) ?? projects[0]} />
            )}
          </div>
          )
        )}

        {/* ── PROGRESS TAB ── */}
        {clientTab === 'progress' && (
          projects.length === 0 ? (
            <div className="text-center py-10 bg-slate-50 rounded-2xl border border-slate-100">
              <p className="text-slate-400 text-sm">No projects yet.</p>
            </div>
          ) : (
          <div>
            <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
              <div>
                <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">Project</label>
                <select value={progressProject} onChange={e => { setProgressProject(e.target.value); loadProgress(e.target.value) }}
                  className="border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:border-[#1F4E79] min-w-[220px]">
                  {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </div>
              <p className="text-[11px] text-slate-400 max-w-xs text-right">Shows each member's progress through this project's <strong>pathway</strong> steps.</p>
            </div>
            {progressData.users.length === 0 ? (
              <div className="text-center py-10 text-slate-400 text-sm">No members assigned to this project yet.</div>
            ) : progressData.items.length === 0 ? (
              <div className="text-center py-10 bg-slate-50 rounded-2xl border border-slate-100 text-slate-400 text-sm">
                No pathway set for this project yet. Set the pathway steps (Pathway tab) to track progress here.
              </div>
            ) : (
              <div className="space-y-8">
                {phaseGroups.map(({ phase, items }) => (
                  <div key={phase}>
                    <p className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-3">
                      {PHASE_ICONS[phase]} Phase {String(phase).padStart(2,'0')} — {PHASE_NAMES[phase]}
                    </p>

                    {/* Segment headers — one label per pathway item, aligned to the bars below */}
                    <div className="flex items-end gap-3 mb-1.5">
                      <div className="w-[150px] shrink-0 text-[10px] font-semibold text-slate-400 uppercase tracking-widest">User</div>
                      <div className="flex-1 flex gap-1">
                        {items.map((item, i) => (
                          <div key={item.id} className="flex-1 min-w-0 text-center" title={item.title}>
                            <span className="block text-[10px] font-medium text-slate-500 truncate leading-tight">{i + 1}. {item.title}</span>
                          </div>
                        ))}
                      </div>
                      <div className="w-16 shrink-0 text-right text-[10px] font-semibold text-slate-400 uppercase tracking-widest">Done</div>
                    </div>

                    {/* One segmented bar per member */}
                    <div className="space-y-1">
                      {progressData.users.map(user => {
                        const done = items.filter(i => getActivity(user.id, i.id) === 'completed').length
                        return (
                          <div key={user.id} className="flex items-center gap-3 py-1">
                            <div className="w-[150px] shrink-0 text-sm font-medium text-slate-700 truncate">
                              {user.full_name ?? '—'}
                              {user.role && <span className="ml-1 text-[10px] text-slate-400">({user.role})</span>}
                            </div>
                            <div className="flex-1 flex gap-1">
                              {items.map(item => {
                                const st = getActivity(user.id, item.id)
                                const bg = st === 'completed' ? '#16a34a' : st === 'in_progress' ? '#378ADD' : ''
                                const lbl = st === 'completed' ? 'Completed' : st === 'in_progress' ? 'In progress' : 'Not started'
                                return (
                                  <div key={item.id} title={`${item.title} — ${lbl}`}
                                    className={`flex-1 h-4 rounded ${bg ? '' : 'bg-white border border-slate-200'}`}
                                    style={bg ? { background: bg } : undefined} />
                                )
                              })}
                            </div>
                            <div className="w-16 shrink-0 text-right text-sm font-bold text-[#1F4E79]">{done}/{items.length}</div>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                ))}
                <div className="flex gap-4 text-xs text-slate-400 pt-2 border-t border-slate-100">
                  <span><span className="inline-block w-3 h-3 rounded-sm align-middle mr-1" style={{ background: '#16a34a' }} />Completed</span>
                  <span><span className="inline-block w-3 h-3 rounded-sm align-middle mr-1" style={{ background: '#378ADD' }} />In Progress</span>
                  <span><span className="inline-block w-3 h-3 rounded-sm border border-slate-200 bg-white align-middle mr-1" />Not Started</span>
                </div>
              </div>
            )}
          </div>
          )
        )}
        {modals}
      </div>
    )
  }

  // Scoped mode never shows the all-clients list — just wait for the client to open.
  if (lockedClientId) {
    return <div className="space-y-3">{[1,2,3].map(n => <div key={n} className="h-16 bg-slate-100 rounded-xl animate-pulse" />)}</div>
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
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          {clients.map(client => {
            const userCount = allUsers.filter(u => u.client_id === client.id).length
            return (
              <div key={client.id}
                className={`bg-white border border-slate-100 rounded-2xl p-4 flex flex-col gap-2 hover:shadow-sm hover:border-[#1F4E79]/25 transition-all cursor-pointer group ${!client.is_active ? 'opacity-60' : ''}`}
                onClick={() => openClient(client)}>
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 rounded-xl bg-[#1F4E79]/10 flex items-center justify-center font-bold text-[#1F4E79] shrink-0">
                    {client.name.charAt(0).toUpperCase()}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="font-semibold text-slate-800 text-sm leading-tight">{client.name}</p>
                      {!client.is_active && <span className="text-[10px] bg-slate-100 text-slate-400 px-2 py-0.5 rounded-full">Inactive</span>}
                    </div>
                    {client.industry && <p className="text-[11px] text-slate-400 mt-0.5">{industryLabel(client.industry)}</p>}
                  </div>
                  <svg className="w-4 h-4 text-slate-300 group-hover:text-[#1F4E79] transition-colors shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                  </svg>
                </div>
                <p className="text-xs text-slate-500">
                  {userCount} user{userCount !== 1 ? 's' : ''}{client.contact_name ? ` · ${client.contact_name}` : ''}
                </p>
                <div className="flex gap-3 pt-2.5 mt-auto border-t border-slate-100" onClick={e => e.stopPropagation()}>
                  <button onClick={() => { setClientForm({ name: client.name, industry: client.industry ?? '', contact_name: client.contact_name ?? '', contact_email: client.contact_email ?? '', notes: client.notes ?? '', is_active: client.is_active }); setClientEditId(client.id); setClientError(null); setShowClientForm(true) }}
                    className="text-xs text-[#1F4E79] hover:underline">Edit</button>
                  <button onClick={() => deleteClient(client.id)} className="text-xs text-red-400 hover:underline">Delete</button>
                  <button onClick={() => openClient(client)} className="text-xs text-slate-400 hover:text-[#1F4E79] hover:underline ml-auto">Open →</button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {modals}
    </div>
  )
}
