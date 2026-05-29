import { useState, useEffect } from 'react'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../lib/supabase'

const PHASES = [
  { num: 1, label: '01 Diagnose' },
  { num: 2, label: '02 Design' },
  { num: 3, label: '03 Engage' },
  { num: 4, label: '04 Embed' },
  { num: 5, label: '05 Evaluate' },
]

const INDUSTRIES = [
  { value: 'financial-services',  label: '🏦 Financial Services' },
  { value: 'healthcare',          label: '🏥 Healthcare' },
  { value: 'utilities-energy',    label: '⚡ Utilities & Energy' },
  { value: 'telecommunications',  label: '📡 Telecommunications' },
  { value: 'manufacturing',       label: '🏭 Manufacturing' },
  { value: 'public-sector',       label: '🏛 Public Sector' },
  { value: 'retail-consumer',     label: '🛒 Retail & Consumer' },
]

const CONTENT_TYPES = [
  { value: 'exercise', label: 'Exercise' },
  { value: 'tool',     label: 'Tool' },
  { value: 'template', label: 'Template' },
]

const SECTIONS = ['Content Manager', 'Phase Manager', 'Role Manager']

const emptyContentForm = {
  phase_number: 1,
  industry: '',
  role: '',
  content_type: 'exercise',
  title: '',
  description: '',
  is_common: true,
  sort_order: 0,
}

const emptyRoleForm = {
  code: '',
  label: '',
  icon: '🔷',
  description: '',
  detail: '',
  sort_order: 0,
  is_active: true,
}

const ICON_OPTIONS = ['🔷', '🔶', '🟩', '🟧', '🟪', '🔵', '🟡', '🔴', '⭐', '🏅']

export default function Admin() {
  const { profile } = useAuth()
  const [section, setSection] = useState('Content Manager')

  // ── Content Manager state ──
  const [filterPhase,    setFilterPhase]    = useState(1)
  const [filterIndustry, setFilterIndustry] = useState('')
  const [filterRole,     setFilterRole]     = useState('')
  const [items,          setItems]          = useState([])
  const [contentLoading, setContentLoading] = useState(false)
  const [showForm,       setShowForm]       = useState(false)
  const [form,           setForm]           = useState(emptyContentForm)
  const [editId,         setEditId]         = useState(null)
  const [saving,         setSaving]         = useState(false)
  const [formError,      setFormError]      = useState(null)

  // ── Phase Manager state ──
  const [allProjects,   setAllProjects]   = useState([])
  const [selectedUser,  setSelectedUser]  = useState('')   // project id
  const [phaseLoading,  setPhaseLoading]  = useState(false)
  const [unlocking,     setUnlocking]     = useState(null)

  // ── Role Manager state ──
  const [roles,         setRoles]         = useState([])
  const [rolesLoading,  setRolesLoading]  = useState(false)
  const [showRoleForm,  setShowRoleForm]  = useState(false)
  const [roleForm,      setRoleForm]      = useState(emptyRoleForm)
  const [roleEditId,    setRoleEditId]    = useState(null)
  const [roleSaving,    setRoleSaving]    = useState(false)
  const [roleFormError, setRoleFormError] = useState(null)

  if (!profile?.is_admin) {
    return (
      <div className="p-8 text-center text-slate-500">
        You don't have permission to access this page.
      </div>
    )
  }

  // eslint-disable-next-line react-hooks/rules-of-hooks
  useEffect(() => {
    if (section === 'Content Manager') fetchItems()
    if (section === 'Phase Manager')   fetchProjects()
    if (section === 'Role Manager')    fetchRoles()
  }, [section, filterPhase, filterIndustry, filterRole])

  // ── Content Manager ──
  async function fetchItems() {
    setContentLoading(true)
    let query = supabase
      .from('phase_content')
      .select('*')
      .eq('phase_number', filterPhase)
      .order('sort_order', { ascending: true })
    if (filterIndustry) query = query.eq('industry', filterIndustry)
    if (filterRole)     query = query.eq('role', filterRole)
    const { data } = await query
    setItems(data ?? [])
    setContentLoading(false)
  }

  function openNewContent() {
    setForm({ ...emptyContentForm, phase_number: filterPhase, industry: filterIndustry, role: filterRole })
    setEditId(null)
    setFormError(null)
    setShowForm(true)
  }

  function openEditContent(item) {
    setForm({
      phase_number: item.phase_number,
      industry:     item.industry ?? '',
      role:         item.role ?? '',
      content_type: item.content_type,
      title:        item.title,
      description:  item.description ?? '',
      is_common:    item.is_common,
      sort_order:   item.sort_order ?? 0,
    })
    setEditId(item.id)
    setFormError(null)
    setShowForm(true)
  }

  async function handleContentSave() {
    if (!form.title.trim()) { setFormError('Title is required'); return }
    setSaving(true)
    const payload = { ...form, industry: form.industry || null, role: form.role || null }
    let error
    if (editId) {
      ;({ error } = await supabase.from('phase_content').update(payload).eq('id', editId))
    } else {
      ;({ error } = await supabase.from('phase_content').insert(payload))
    }
    setSaving(false)
    if (error) { setFormError(error.message); return }
    setShowForm(false)
    fetchItems()
  }

  async function handleContentDelete(id) {
    if (!window.confirm('Delete this item?')) return
    await supabase.from('phase_content').delete().eq('id', id)
    fetchItems()
  }

  // ── Phase Manager ──
  async function fetchProjects() {
    setPhaseLoading(true)
    const { data: projects } = await supabase
      .from('projects')
      .select('id, name, user_id, profiles(full_name, role, industry)')
      .order('created_at', { ascending: true })

    if (!projects) { setPhaseLoading(false); return }

    const enriched = await Promise.all(projects.map(async proj => {
      const { data: phases } = await supabase
        .from('project_phases')
        .select('*')
        .eq('project_id', proj.id)
        .order('phase_number', { ascending: true })
      return { ...proj, phases: phases ?? [] }
    }))

    setAllProjects(enriched)
    if (!selectedUser && enriched.length > 0) setSelectedUser(enriched[0].id)
    setPhaseLoading(false)
  }

  async function unlockPhase(projectId, phaseNumber) {
    const key = `${projectId}-${phaseNumber}`
    setUnlocking(key)
    await supabase.from('project_phases').update({ status: 'active' }).eq('project_id', projectId).eq('phase_number', phaseNumber)
    await fetchProjects()
    setUnlocking(null)
  }

  async function lockPhase(projectId, phaseNumber) {
    const key = `${projectId}-${phaseNumber}`
    setUnlocking(key)
    await supabase.from('project_phases').update({ status: 'locked' }).eq('project_id', projectId).eq('phase_number', phaseNumber)
    await fetchProjects()
    setUnlocking(null)
  }

  // ── Role Manager ──
  async function fetchRoles() {
    setRolesLoading(true)
    const { data } = await supabase.from('roles').select('*').order('sort_order', { ascending: true })
    setRoles(data ?? [])
    setRolesLoading(false)
  }

  function openNewRole() {
    setRoleForm({ ...emptyRoleForm, sort_order: (roles.length + 1) * 10 })
    setRoleEditId(null)
    setRoleFormError(null)
    setShowRoleForm(true)
  }

  function openEditRole(role) {
    setRoleForm({
      code:        role.code,
      label:       role.label,
      icon:        role.icon ?? '🔷',
      description: role.description ?? '',
      detail:      role.detail ?? '',
      sort_order:  role.sort_order ?? 0,
      is_active:   role.is_active,
    })
    setRoleEditId(role.id)
    setRoleFormError(null)
    setShowRoleForm(true)
  }

  async function handleRoleSave() {
    if (!roleForm.label.trim()) { setRoleFormError('Label is required'); return }
    if (!roleForm.code.trim())  { setRoleFormError('Code is required'); return }
    // Code must be lowercase letters only
    if (!/^[a-z0-9_]+$/.test(roleForm.code)) { setRoleFormError('Code must be lowercase letters, numbers or underscores only'); return }

    setRoleSaving(true)
    let error
    if (roleEditId) {
      ;({ error } = await supabase.from('roles').update(roleForm).eq('id', roleEditId))
    } else {
      ;({ error } = await supabase.from('roles').insert(roleForm))
    }
    setRoleSaving(false)
    if (error) { setRoleFormError(error.message); return }
    setShowRoleForm(false)
    fetchRoles()
  }

  async function handleRoleDelete(id) {
    if (!window.confirm('Delete this role? Users who selected this role will keep it, but it will no longer appear in onboarding.')) return
    await supabase.from('roles').delete().eq('id', id)
    fetchRoles()
  }

  async function toggleRoleActive(role) {
    await supabase.from('roles').update({ is_active: !role.is_active }).eq('id', role.id)
    fetchRoles()
  }

  // ── Shared UI helpers ──
  const typeColor = { exercise: 'bg-blue-100 text-blue-700', tool: 'bg-green-100 text-green-700', template: 'bg-purple-100 text-purple-700' }

  const selectedProject = allProjects.find(p => p.id === selectedUser)

  return (
    <div className="p-8 max-w-5xl">
      {/* Header */}
      <div className="mb-6">
        <p className="text-xs text-slate-400 uppercase tracking-widest font-semibold mb-1">Admin</p>
        <h1 className="text-2xl font-bold text-slate-800">Platform Management</h1>
      </div>

      {/* Section tabs */}
      <div className="flex gap-2 mb-8 border-b border-slate-200">
        {SECTIONS.map(s => (
          <button key={s} onClick={() => setSection(s)}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              section === s ? 'border-[#1F4E79] text-[#1F4E79]' : 'border-transparent text-slate-500 hover:text-slate-700'
            }`}>
            {s}
          </button>
        ))}
      </div>

      {/* ── CONTENT MANAGER ── */}
      {section === 'Content Manager' && (
        <div>
          <div className="flex flex-wrap gap-3 mb-6">
            <div>
              <label className="block text-[10px] font-semibold text-slate-500 uppercase mb-1">Phase</label>
              <select value={filterPhase} onChange={e => setFilterPhase(Number(e.target.value))}
                className="border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-700 focus:outline-none focus:border-[#1F4E79]">
                {PHASES.map(p => <option key={p.num} value={p.num}>{p.label}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-[10px] font-semibold text-slate-500 uppercase mb-1">Industry</label>
              <select value={filterIndustry} onChange={e => setFilterIndustry(e.target.value)}
                className="border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-700 focus:outline-none focus:border-[#1F4E79]">
                <option value="">All industries</option>
                {INDUSTRIES.map(i => <option key={i.value} value={i.value}>{i.label}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-[10px] font-semibold text-slate-500 uppercase mb-1">Role</label>
              <select value={filterRole} onChange={e => setFilterRole(e.target.value)}
                className="border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-700 focus:outline-none focus:border-[#1F4E79]">
                <option value="">All roles</option>
                {roles.map(r => <option key={r.code} value={r.code}>{r.label}</option>)}
              </select>
            </div>
            <div className="flex items-end">
              <button onClick={openNewContent}
                className="bg-[#E8913A] text-white text-sm font-semibold px-4 py-2 rounded-lg hover:bg-[#d07e2e] transition-colors">
                + Add Content
              </button>
            </div>
          </div>

          {contentLoading ? (
            <p className="text-sm text-slate-400">Loading…</p>
          ) : items.length === 0 ? (
            <div className="text-center py-16 bg-slate-50 rounded-xl border border-slate-200">
              <p className="text-slate-400 text-sm mb-3">No content yet for this selection.</p>
              <button onClick={openNewContent} className="text-[#1F4E79] text-sm font-semibold hover:underline">+ Add the first item</button>
            </div>
          ) : (
            <div className="space-y-2">
              {items.map(item => (
                <div key={item.id} className="flex items-start gap-4 bg-white border border-slate-200 rounded-xl p-4">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${typeColor[item.content_type]}`}>{item.content_type}</span>
                      {!item.is_common && <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-amber-100 text-amber-700">Add-on</span>}
                      {item.industry && <span className="text-[10px] text-slate-400">{item.industry}</span>}
                      {item.role && <span className="text-[10px] text-slate-400">· {item.role.toUpperCase()}</span>}
                    </div>
                    <p className="font-medium text-slate-800 text-sm">{item.title}</p>
                    {item.description && <p className="text-xs text-slate-500 mt-0.5 leading-relaxed line-clamp-2">{item.description}</p>}
                  </div>
                  <div className="flex gap-2 shrink-0">
                    <button onClick={() => openEditContent(item)} className="text-xs text-[#1F4E79] hover:underline">Edit</button>
                    <button onClick={() => handleContentDelete(item.id)} className="text-xs text-red-400 hover:underline">Delete</button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── PHASE MANAGER ── */}
      {section === 'Phase Manager' && (
        <div>
          <p className="text-sm text-slate-500 mb-5">
            Select a user and open or lock their phases on demand.
          </p>

          {phaseLoading ? (
            <p className="text-sm text-slate-400">Loading users…</p>
          ) : allProjects.length === 0 ? (
            <p className="text-sm text-slate-400">No registered users with projects yet.</p>
          ) : (
            <>
              {/* User selector */}
              <div className="mb-6">
                <label className="block text-[10px] font-semibold text-slate-500 uppercase mb-2">Select User</label>
                <div className="flex flex-wrap gap-2">
                  {allProjects.map(proj => {
                    const name = proj.profiles?.full_name ?? 'Unknown'
                    const initials = name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2)
                    const isSelected = selectedUser === proj.id
                    return (
                      <button
                        key={proj.id}
                        onClick={() => setSelectedUser(proj.id)}
                        className={`flex items-center gap-2 px-3 py-2 rounded-xl border text-sm font-medium transition-all ${
                          isSelected
                            ? 'bg-[#1F4E79] text-white border-[#1F4E79] shadow-md'
                            : 'bg-white text-slate-700 border-slate-200 hover:border-[#1F4E79]/40'
                        }`}
                      >
                        <div className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0 ${
                          isSelected ? 'bg-white/20 text-white' : 'bg-[#1F4E79] text-white'
                        }`}>
                          {initials}
                        </div>
                        {name}
                      </button>
                    )
                  })}
                </div>
              </div>

              {/* Selected user phases */}
              {selectedProject && (
                <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
                  {/* User detail header */}
                  <div className="px-5 py-4 border-b border-slate-100 bg-slate-50 flex items-center justify-between">
                    <div>
                      <p className="font-semibold text-slate-800">{selectedProject.profiles?.full_name ?? 'Unknown'}</p>
                      <p className="text-xs text-slate-400 mt-0.5">
                        {roles.find(r => r.code === selectedProject.profiles?.role)?.label ?? selectedProject.profiles?.role ?? '—'}
                        {' · '}
                        {INDUSTRIES.find(i => i.value === selectedProject.profiles?.industry)?.label ?? selectedProject.profiles?.industry ?? '—'}
                      </p>
                    </div>
                    <div className="flex gap-1">
                      {[1,2,3,4,5].map(n => {
                        const ph = selectedProject.phases.find(p => p.phase_number === n)
                        return (
                          <div key={n} className={`w-2 h-2 rounded-full ${
                            ph?.status === 'completed' ? 'bg-green-400' :
                            ph?.status === 'active'    ? 'bg-[#1F4E79]' : 'bg-slate-200'
                          }`} />
                        )
                      })}
                    </div>
                  </div>

                  {/* Phase rows */}
                  <div className="divide-y divide-slate-50">
                    {selectedProject.phases.map(phase => {
                      const cfg    = PHASES.find(p => p.num === phase.phase_number)
                      const rowKey = `${selectedProject.id}-${phase.phase_number}`
                      const busy   = unlocking === rowKey

                      return (
                        <div key={phase.phase_number} className="flex items-center gap-4 px-5 py-3.5">
                          <span className="text-xs font-bold text-slate-500 w-20 shrink-0">{cfg?.label}</span>
                          <span className={`text-[10px] font-semibold px-2.5 py-1 rounded-full shrink-0 ${
                            phase.status === 'completed' ? 'bg-green-100 text-green-700' :
                            phase.status === 'active'    ? 'bg-blue-100 text-blue-700' :
                                                           'bg-slate-100 text-slate-400'
                          }`}>
                            {phase.status === 'completed' ? '✓ Completed' : phase.status === 'active' ? '● Active' : '○ Locked'}
                          </span>
                          <div className="flex-1" />
                          {phase.status === 'locked' && (
                            <button onClick={() => unlockPhase(selectedProject.id, phase.phase_number)} disabled={busy}
                              className="text-xs font-semibold text-[#1F4E79] border border-[#1F4E79]/30 hover:bg-[#1F4E79]/5 px-4 py-1.5 rounded-lg transition-colors disabled:opacity-50">
                              {busy ? 'Opening…' : '🔓 Open phase'}
                            </button>
                          )}
                          {phase.status === 'active' && (
                            <button onClick={() => lockPhase(selectedProject.id, phase.phase_number)} disabled={busy}
                              className="text-xs font-semibold text-slate-400 border border-slate-200 hover:border-slate-300 px-4 py-1.5 rounded-lg transition-colors disabled:opacity-50">
                              {busy ? 'Locking…' : '🔒 Lock'}
                            </button>
                          )}
                          {phase.status === 'completed' && (
                            <span className="text-xs text-slate-300 px-4">—</span>
                          )}
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* ── ROLE MANAGER ── */}
      {section === 'Role Manager' && (
        <div>
          <div className="flex items-center justify-between mb-5">
            <p className="text-sm text-slate-500">
              Roles appear in onboarding and control which content users see. Adding a new role here makes it available immediately.
            </p>
            <button onClick={openNewRole}
              className="shrink-0 ml-4 bg-[#E8913A] text-white text-sm font-semibold px-4 py-2 rounded-lg hover:bg-[#d07e2e] transition-colors">
              + Add Role
            </button>
          </div>

          {rolesLoading ? (
            <p className="text-sm text-slate-400">Loading roles…</p>
          ) : roles.length === 0 ? (
            <div className="text-center py-12 bg-slate-50 rounded-xl border border-slate-200">
              <p className="text-slate-400 text-sm mb-3">No roles yet.</p>
              <button onClick={openNewRole} className="text-[#1F4E79] text-sm font-semibold hover:underline">+ Add the first role</button>
            </div>
          ) : (
            <div className="space-y-2">
              {roles.map(role => (
                <div key={role.id} className={`flex items-center gap-4 bg-white border rounded-2xl px-5 py-4 transition-opacity ${!role.is_active ? 'opacity-50' : ''}`}>
                  {/* Icon */}
                  <span className="text-2xl shrink-0">{role.icon}</span>

                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <p className="font-semibold text-slate-800 text-sm">{role.label}</p>
                      <code className="text-[10px] bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded font-mono">{role.code}</code>
                      {!role.is_active && (
                        <span className="text-[10px] bg-slate-100 text-slate-400 px-2 py-0.5 rounded-full font-semibold">Inactive</span>
                      )}
                    </div>
                    {role.description && <p className="text-xs text-slate-500 truncate">{role.description}</p>}
                  </div>

                  {/* Controls */}
                  <div className="flex items-center gap-3 shrink-0">
                    <button onClick={() => toggleRoleActive(role)}
                      className={`text-xs font-semibold px-3 py-1 rounded-lg border transition-colors ${
                        role.is_active
                          ? 'text-slate-400 border-slate-200 hover:border-slate-300'
                          : 'text-green-600 border-green-200 hover:bg-green-50'
                      }`}>
                      {role.is_active ? 'Deactivate' : 'Activate'}
                    </button>
                    <button onClick={() => openEditRole(role)} className="text-xs text-[#1F4E79] hover:underline">Edit</button>
                    <button onClick={() => handleRoleDelete(role.id)} className="text-xs text-red-400 hover:underline">Delete</button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── CONTENT FORM MODAL ── */}
      {showForm && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg">
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
              <h2 className="font-semibold text-slate-800">{editId ? 'Edit Content' : 'Add Content'}</h2>
              <button onClick={() => setShowForm(false)} className="text-slate-400 hover:text-slate-600 text-xl leading-none">✕</button>
            </div>
            <div className="px-6 py-5 space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">Phase</label>
                  <select value={form.phase_number} onChange={e => setForm({...form, phase_number: Number(e.target.value)})}
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#1F4E79]">
                    {PHASES.map(p => <option key={p.num} value={p.num}>{p.label}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">Type</label>
                  <select value={form.content_type} onChange={e => setForm({...form, content_type: e.target.value})}
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#1F4E79]">
                    {CONTENT_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">Industry <span className="text-slate-400 font-normal">(blank = all)</span></label>
                  <select value={form.industry} onChange={e => setForm({...form, industry: e.target.value})}
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#1F4E79]">
                    <option value="">All industries</option>
                    {INDUSTRIES.map(i => <option key={i.value} value={i.value}>{i.label}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">Role <span className="text-slate-400 font-normal">(blank = all)</span></label>
                  <select value={form.role} onChange={e => setForm({...form, role: e.target.value})}
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#1F4E79]">
                    <option value="">All roles</option>
                    {roles.map(r => <option key={r.code} value={r.code}>{r.label}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1">Title *</label>
                <input value={form.title} onChange={e => setForm({...form, title: e.target.value})}
                  placeholder="e.g. Change Readiness Assessment"
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#1F4E79]" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1">Description</label>
                <textarea value={form.description} onChange={e => setForm({...form, description: e.target.value})}
                  placeholder="What does this tool/exercise help the user achieve?"
                  rows={3} className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm resize-none focus:outline-none focus:border-[#1F4E79]" />
              </div>
              <div className="flex items-center justify-between">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={form.is_common} onChange={e => setForm({...form, is_common: e.target.checked})}
                    className="w-4 h-4 accent-[#1F4E79]" />
                  <span className="text-sm text-slate-700">Common <span className="text-slate-400 text-xs">(shown to all)</span></span>
                </label>
                <div className="flex items-center gap-2">
                  <label className="text-xs text-slate-500">Order</label>
                  <input type="number" value={form.sort_order} onChange={e => setForm({...form, sort_order: Number(e.target.value)})}
                    className="w-16 border border-slate-200 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:border-[#1F4E79]" />
                </div>
              </div>
              {formError && <p className="text-sm text-red-500">{formError}</p>}
            </div>
            <div className="px-6 py-4 border-t border-slate-100 flex justify-end gap-3">
              <button onClick={() => setShowForm(false)} className="text-sm text-slate-500 hover:text-slate-700 px-4 py-2">Cancel</button>
              <button onClick={handleContentSave} disabled={saving}
                className="bg-[#1F4E79] text-white text-sm font-semibold px-6 py-2 rounded-lg hover:bg-[#163a5c] transition-colors disabled:opacity-60">
                {saving ? 'Saving…' : editId ? 'Save Changes' : 'Add Content'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── ROLE FORM MODAL ── */}
      {showRoleForm && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg">
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
              <h2 className="font-semibold text-slate-800">{roleEditId ? 'Edit Role' : 'Add New Role'}</h2>
              <button onClick={() => setShowRoleForm(false)} className="text-slate-400 hover:text-slate-600 text-xl leading-none">✕</button>
            </div>
            <div className="px-6 py-5 space-y-4">

              {/* Icon picker */}
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-2">Icon</label>
                <div className="flex gap-2 flex-wrap">
                  {ICON_OPTIONS.map(icon => (
                    <button key={icon} onClick={() => setRoleForm({...roleForm, icon})}
                      className={`w-9 h-9 text-xl rounded-lg border-2 transition-all ${
                        roleForm.icon === icon ? 'border-[#1F4E79] bg-[#1F4E79]/5' : 'border-slate-200 hover:border-slate-300'
                      }`}>
                      {icon}
                    </button>
                  ))}
                </div>
              </div>

              {/* Label + Code */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">Label * <span className="font-normal text-slate-400">(display name)</span></label>
                  <input value={roleForm.label} onChange={e => setRoleForm({...roleForm, label: e.target.value})}
                    placeholder="e.g. Executive Sponsor"
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#1F4E79]" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">Code * <span className="font-normal text-slate-400">(unique, lowercase)</span></label>
                  <input value={roleForm.code} onChange={e => setRoleForm({...roleForm, code: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '')})}
                    placeholder="e.g. exec_sponsor"
                    disabled={!!roleEditId}
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#1F4E79] disabled:bg-slate-50 disabled:text-slate-400"
                  />
                  {roleEditId && <p className="text-[10px] text-slate-400 mt-1">Code cannot be changed after creation</p>}
                </div>
              </div>

              {/* Short description */}
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1">Short Description <span className="font-normal text-slate-400">(shown on card)</span></label>
                <input value={roleForm.description} onChange={e => setRoleForm({...roleForm, description: e.target.value})}
                  placeholder="e.g. Vision, sponsorship & decision authority"
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#1F4E79]" />
              </div>

              {/* Detail */}
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1">Detail <span className="font-normal text-slate-400">(longer explanation on card)</span></label>
                <textarea value={roleForm.detail} onChange={e => setRoleForm({...roleForm, detail: e.target.value})}
                  placeholder="Describe what this role does in a change programme..."
                  rows={2} className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm resize-none focus:outline-none focus:border-[#1F4E79]" />
              </div>

              {/* Sort order + Active */}
              <div className="flex items-center justify-between">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={roleForm.is_active} onChange={e => setRoleForm({...roleForm, is_active: e.target.checked})}
                    className="w-4 h-4 accent-[#1F4E79]" />
                  <span className="text-sm text-slate-700">Active <span className="text-slate-400 text-xs">(visible in onboarding)</span></span>
                </label>
                <div className="flex items-center gap-2">
                  <label className="text-xs text-slate-500">Order</label>
                  <input type="number" value={roleForm.sort_order} onChange={e => setRoleForm({...roleForm, sort_order: Number(e.target.value)})}
                    className="w-16 border border-slate-200 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:border-[#1F4E79]" />
                </div>
              </div>

              {roleFormError && <p className="text-sm text-red-500">{roleFormError}</p>}
            </div>
            <div className="px-6 py-4 border-t border-slate-100 flex justify-end gap-3">
              <button onClick={() => setShowRoleForm(false)} className="text-sm text-slate-500 hover:text-slate-700 px-4 py-2">Cancel</button>
              <button onClick={handleRoleSave} disabled={roleSaving}
                className="bg-[#1F4E79] text-white text-sm font-semibold px-6 py-2 rounded-lg hover:bg-[#163a5c] transition-colors disabled:opacity-60">
                {roleSaving ? 'Saving…' : roleEditId ? 'Save Changes' : 'Add Role'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
