import { useState, useEffect, useRef } from 'react'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../lib/supabase'

const PHASES = [
  { num: 1, label: '01 Diagnose' },
  { num: 2, label: '02 Design' },
  { num: 3, label: '03 Engage' },
  { num: 4, label: '04 Embed' },
  { num: 5, label: '05 Evaluate' },
]

const CONTENT_TYPES = [
  { value: 'exercise', label: 'Exercise' },
  { value: 'tool',     label: 'Tool' },
  { value: 'template', label: 'Template' },
]

const SECTIONS = ['Content Manager', 'Phase Manager', 'Role Manager', 'Industry Manager', 'Templates']

const COLUMN_TYPES = [
  { value: 'text',     label: 'Text' },
  { value: 'number',   label: 'Number' },
  { value: 'date',     label: 'Date' },
  { value: 'select',   label: 'Select (dropdown)' },
  { value: 'rating',   label: 'Rating (1–5)' },
  { value: 'checkbox', label: 'Checkbox' },
]

const emptyTemplateForm = {
  title:        '',
  description:  '',
  phase_number: 1,
  industry:     '',
  role:         '',
  file_url:     '',
  sort_order:   0,
  is_active:    true,
}

function makeCol() {
  return { _id: Math.random().toString(36).slice(2), label: '', type: 'text', required: false, options: '' }
}

const ROLE_ICON_OPTIONS     = ['🔷', '🔶', '🟩', '🟧', '🟪', '🔵', '🟡', '🔴', '⭐', '🏅']
const INDUSTRY_ICON_OPTIONS = ['🏦', '🏥', '⚡', '📡', '🏭', '🏛', '🛒', '🌐', '🔬', '🏢', '💼', '🚀']

const emptyContentForm = {
  phase_number: 1,
  industry: '',
  role: '',
  content_type: 'exercise',
  title: '',
  description: '',
  body: '',
  file_url: '',
  is_common: true,
  sort_order: 0,
  template_id: '',
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

const emptyIndustryForm = {
  code: '',
  label: '',
  icon: '🏢',
  detail: '',
  sort_order: 0,
  is_active: true,
}

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
  const [selectedUser,  setSelectedUser]  = useState('')
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

  // ── Industry Manager state ──
  const [industries,         setIndustries]         = useState([])
  const [industriesLoading,  setIndustriesLoading]  = useState(false)
  const [showIndustryForm,   setShowIndustryForm]   = useState(false)
  const [industryForm,       setIndustryForm]       = useState(emptyIndustryForm)
  const [industryEditId,     setIndustryEditId]     = useState(null)
  const [industrySaving,     setIndustrySaving]     = useState(false)
  const [industryFormError,  setIndustryFormError]  = useState(null)

  // ── Templates state ──
  const [templates,          setTemplates]          = useState([])
  const [templatesLoading,   setTemplatesLoading]   = useState(false)
  const [showTemplateForm,   setShowTemplateForm]   = useState(false)
  const [templateForm,       setTemplateForm]       = useState(emptyTemplateForm)
  const [templateCols,       setTemplateCols]       = useState([])   // column builder
  const [templateEditId,     setTemplateEditId]     = useState(null)
  const [templateSaving,     setTemplateSaving]     = useState(false)
  const [templateFormError,  setTemplateFormError]  = useState(null)

  if (!profile?.is_admin) {
    return (
      <div className="p-8 text-center text-slate-500">
        You don't have permission to access this page.
      </div>
    )
  }

  // Always fetch roles + industries on mount (needed for Content Manager dropdowns)
  // eslint-disable-next-line react-hooks/rules-of-hooks
  useEffect(() => {
    fetchRoles()
    fetchIndustries()
    fetchTemplates()
  }, [])

  // eslint-disable-next-line react-hooks/rules-of-hooks
  useEffect(() => {
    if (section === 'Content Manager') fetchItems()
    if (section === 'Phase Manager')   fetchProjects()
    if (section === 'Role Manager')    fetchRoles()
    if (section === 'Industry Manager') fetchIndustries()
    if (section === 'Templates')        fetchTemplates()
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
      body:         item.body ?? '',
      file_url:     item.file_url ?? '',
      is_common:    item.is_common,
      sort_order:   item.sort_order ?? 0,
      template_id:  item.template_id ?? '',
    })
    setEditId(item.id)
    setFormError(null)
    setShowForm(true)
  }

  async function handleContentSave() {
    if (!form.title.trim()) { setFormError('Title is required'); return }
    setSaving(true)
    const payload = {
      ...form,
      industry:    form.industry    || null,
      role:        form.role        || null,
      body:        form.body        || null,
      file_url:    form.file_url    || null,
      template_id: form.template_id || null,
    }
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

  // ── Industry Manager ──
  async function fetchIndustries() {
    setIndustriesLoading(true)
    const { data } = await supabase.from('industries').select('*').order('sort_order', { ascending: true })
    setIndustries(data ?? [])
    setIndustriesLoading(false)
  }

  function openNewIndustry() {
    setIndustryForm({ ...emptyIndustryForm, sort_order: (industries.length + 1) * 10 })
    setIndustryEditId(null)
    setIndustryFormError(null)
    setShowIndustryForm(true)
  }

  function openEditIndustry(ind) {
    setIndustryForm({
      code:       ind.code,
      label:      ind.label,
      icon:       ind.icon ?? '🏢',
      detail:     ind.detail ?? '',
      sort_order: ind.sort_order ?? 0,
      is_active:  ind.is_active,
    })
    setIndustryEditId(ind.id)
    setIndustryFormError(null)
    setShowIndustryForm(true)
  }

  async function handleIndustrySave() {
    if (!industryForm.label.trim()) { setIndustryFormError('Label is required'); return }
    if (!industryForm.code.trim())  { setIndustryFormError('Code is required'); return }
    if (!/^[a-z0-9_-]+$/.test(industryForm.code)) { setIndustryFormError('Code must be lowercase letters, numbers, hyphens or underscores only'); return }

    setIndustrySaving(true)
    let error
    if (industryEditId) {
      ;({ error } = await supabase.from('industries').update(industryForm).eq('id', industryEditId))
    } else {
      ;({ error } = await supabase.from('industries').insert(industryForm))
    }
    setIndustrySaving(false)
    if (error) { setIndustryFormError(error.message); return }
    setShowIndustryForm(false)
    fetchIndustries()
  }

  async function handleIndustryDelete(id) {
    if (!window.confirm('Delete this industry? Users who selected it will keep it, but it will no longer appear in onboarding.')) return
    await supabase.from('industries').delete().eq('id', id)
    fetchIndustries()
  }

  async function toggleIndustryActive(ind) {
    await supabase.from('industries').update({ is_active: !ind.is_active }).eq('id', ind.id)
    fetchIndustries()
  }

  // ── Templates ──
  async function fetchTemplates() {
    setTemplatesLoading(true)
    const { data } = await supabase.from('templates').select('*').order('phase_number').order('sort_order')
    setTemplates(data ?? [])
    setTemplatesLoading(false)
  }

  function openNewTemplate() {
    setTemplateForm({ ...emptyTemplateForm, sort_order: (templates.length + 1) * 10 })
    setTemplateCols([makeCol()])
    setTemplateEditId(null)
    setTemplateFormError(null)
    setShowTemplateForm(true)
  }

  function openEditTemplate(t) {
    setTemplateForm({
      title:        t.title,
      description:  t.description ?? '',
      phase_number: t.phase_number,
      industry:     t.industry ?? '',
      role:         t.role ?? '',
      file_url:     t.file_url ?? '',
      sort_order:   t.sort_order ?? 0,
      is_active:    t.is_active,
    })
    // Restore columns into builder format
    setTemplateCols((t.columns ?? []).map(c => ({
      _id:      Math.random().toString(36).slice(2),
      label:    c.label,
      type:     c.type,
      required: c.required ?? false,
      options:  (c.options ?? []).join(', '),
    })))
    setTemplateEditId(t.id)
    setTemplateFormError(null)
    setShowTemplateForm(true)
  }

  async function handleTemplateSave() {
    if (!templateForm.title.trim()) { setTemplateFormError('Title is required'); return }
    if (templateCols.length === 0)  { setTemplateFormError('Add at least one column'); return }
    const invalidCol = templateCols.find(c => !c.label.trim())
    if (invalidCol) { setTemplateFormError('All columns need a label'); return }

    const columns = templateCols.map(c => ({
      key:      c.label.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, ''),
      label:    c.label.trim(),
      type:     c.type,
      required: c.required,
      ...(c.type === 'select' ? { options: c.options.split(',').map(o => o.trim()).filter(Boolean) } : {}),
    }))

    const payload = {
      ...templateForm,
      industry: templateForm.industry || null,
      role:     templateForm.role     || null,
      file_url: templateForm.file_url || null,
      columns,
    }

    setTemplateSaving(true)
    let error
    if (templateEditId) {
      ;({ error } = await supabase.from('templates').update(payload).eq('id', templateEditId))
    } else {
      ;({ error } = await supabase.from('templates').insert(payload))
    }
    setTemplateSaving(false)
    if (error) { setTemplateFormError(error.message); return }
    setShowTemplateForm(false)
    fetchTemplates()
  }

  async function handleTemplateDelete(id) {
    if (!window.confirm('Delete this template? All user responses will also be deleted.')) return
    await supabase.from('templates').delete().eq('id', id)
    fetchTemplates()
  }

  async function toggleTemplateActive(t) {
    await supabase.from('templates').update({ is_active: !t.is_active }).eq('id', t.id)
    fetchTemplates()
  }

  // Column builder helpers
  const xlsxInputRef = useRef(null)

  async function importFromExcel(e) {
    const file = e.target.files?.[0]
    if (!file) return

    // Load SheetJS from CDN if not already present
    if (!window.XLSX) {
      await new Promise((resolve, reject) => {
        const script = document.createElement('script')
        script.src = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js'
        script.onload = resolve
        script.onerror = reject
        document.head.appendChild(script)
      })
    }

    const buffer = await file.arrayBuffer()
    const workbook = window.XLSX.read(buffer)
    const sheet = workbook.Sheets[workbook.SheetNames[0]]
    const rows = window.XLSX.utils.sheet_to_json(sheet, { header: 1 })

    if (!rows || rows.length === 0) return

    const headers = rows[0]
    const dataRows = rows.slice(1, 6) // sample up to 5 rows for type inference

    const cols = headers.filter(Boolean).map(header => {
      const colIdx = headers.indexOf(header)
      const samples = dataRows
        .map(r => r[colIdx])
        .filter(v => v !== undefined && v !== '' && v !== null)

      let type = 'text'
      let options = ''

      if (samples.length > 0) {
        const nums = samples.map(Number)
        const allNums = samples.every(v => !isNaN(Number(v)))
        const allInt1to5 = allNums && nums.every(n => n >= 1 && n <= 5 && Number.isInteger(n))
        const unique = [...new Set(samples.map(String))]

        if (allInt1to5 && samples.length >= 2) {
          type = 'rating'
        } else if (allNums) {
          type = 'number'
        } else if (unique.length <= 5 && samples.length >= 3) {
          type = 'select'
          options = unique.join(', ')
        }
      }

      return {
        _id:      Math.random().toString(36).slice(2),
        label:    String(header).trim(),
        type,
        required: false,
        options,
      }
    })

    setTemplateCols(cols)
    e.target.value = '' // allow re-import of same file
  }

  function addCol()          { setTemplateCols(prev => [...prev, makeCol()]) }
  function removeCol(id)     { setTemplateCols(prev => prev.filter(c => c._id !== id)) }
  function moveCol(id, dir)  {
    setTemplateCols(prev => {
      const idx = prev.findIndex(c => c._id === id)
      if (idx < 0) return prev
      const next = idx + dir
      if (next < 0 || next >= prev.length) return prev
      const arr = [...prev]
      ;[arr[idx], arr[next]] = [arr[next], arr[idx]]
      return arr
    })
  }
  function updateCol(id, field, value) {
    setTemplateCols(prev => prev.map(c => c._id === id ? { ...c, [field]: value } : c))
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
      <div className="flex gap-2 mb-8 border-b border-slate-200 overflow-x-auto">
        {SECTIONS.map(s => (
          <button key={s} onClick={() => setSection(s)}
            className={`px-4 py-2 text-sm font-medium border-b-2 whitespace-nowrap transition-colors ${
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
                {industries.map(i => <option key={i.code} value={i.code}>{i.icon} {i.label}</option>)}
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
                      {item.industry && (
                        <span className="text-[10px] text-slate-400">
                          {industries.find(i => i.code === item.industry)?.icon ?? ''} {item.industry}
                        </span>
                      )}
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
                    const name     = proj.profiles?.full_name ?? 'Unknown'
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
                  <div className="px-5 py-4 border-b border-slate-100 bg-slate-50 flex items-center justify-between">
                    <div>
                      <p className="font-semibold text-slate-800">{selectedProject.profiles?.full_name ?? 'Unknown'}</p>
                      <p className="text-xs text-slate-400 mt-0.5">
                        {roles.find(r => r.code === selectedProject.profiles?.role)?.label ?? selectedProject.profiles?.role ?? '—'}
                        {' · '}
                        {industries.find(i => i.code === selectedProject.profiles?.industry)
                          ? `${industries.find(i => i.code === selectedProject.profiles?.industry).icon} ${industries.find(i => i.code === selectedProject.profiles?.industry).label}`
                          : selectedProject.profiles?.industry ?? '—'}
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
                  <span className="text-2xl shrink-0">{role.icon}</span>
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

      {/* ── INDUSTRY MANAGER ── */}
      {section === 'Industry Manager' && (
        <div>
          <div className="flex items-center justify-between mb-5">
            <p className="text-sm text-slate-500">
              Industries appear in onboarding and filter which content users see. Adding a new industry here makes it available immediately.
            </p>
            <button onClick={openNewIndustry}
              className="shrink-0 ml-4 bg-[#E8913A] text-white text-sm font-semibold px-4 py-2 rounded-lg hover:bg-[#d07e2e] transition-colors">
              + Add Industry
            </button>
          </div>

          {industriesLoading ? (
            <p className="text-sm text-slate-400">Loading industries…</p>
          ) : industries.length === 0 ? (
            <div className="text-center py-12 bg-slate-50 rounded-xl border border-slate-200">
              <p className="text-slate-400 text-sm mb-3">No industries yet.</p>
              <button onClick={openNewIndustry} className="text-[#1F4E79] text-sm font-semibold hover:underline">+ Add the first industry</button>
            </div>
          ) : (
            <div className="space-y-2">
              {industries.map(ind => (
                <div key={ind.id} className={`flex items-center gap-4 bg-white border rounded-2xl px-5 py-4 transition-opacity ${!ind.is_active ? 'opacity-50' : ''}`}>
                  <span className="text-2xl shrink-0">{ind.icon}</span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <p className="font-semibold text-slate-800 text-sm">{ind.label}</p>
                      <code className="text-[10px] bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded font-mono">{ind.code}</code>
                      {!ind.is_active && (
                        <span className="text-[10px] bg-slate-100 text-slate-400 px-2 py-0.5 rounded-full font-semibold">Inactive</span>
                      )}
                    </div>
                    {ind.detail && <p className="text-xs text-slate-500 truncate">{ind.detail}</p>}
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    <button onClick={() => toggleIndustryActive(ind)}
                      className={`text-xs font-semibold px-3 py-1 rounded-lg border transition-colors ${
                        ind.is_active
                          ? 'text-slate-400 border-slate-200 hover:border-slate-300'
                          : 'text-green-600 border-green-200 hover:bg-green-50'
                      }`}>
                      {ind.is_active ? 'Deactivate' : 'Activate'}
                    </button>
                    <button onClick={() => openEditIndustry(ind)} className="text-xs text-[#1F4E79] hover:underline">Edit</button>
                    <button onClick={() => handleIndustryDelete(ind.id)} className="text-xs text-red-400 hover:underline">Delete</button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── TEMPLATES ── */}
      {section === 'Templates' && (
        <div>
          <div className="flex items-center justify-between mb-5">
            <p className="text-sm text-slate-500">
              Build structured templates users fill in as interactive tables. Each template defines its own columns and can be targeted by phase, industry, or role.
            </p>
            <button onClick={openNewTemplate}
              className="shrink-0 ml-4 bg-[#E8913A] text-white text-sm font-semibold px-4 py-2 rounded-lg hover:bg-[#d07e2e] transition-colors">
              + New Template
            </button>
          </div>

          {templatesLoading ? (
            <p className="text-sm text-slate-400">Loading templates…</p>
          ) : templates.length === 0 ? (
            <div className="text-center py-12 bg-slate-50 rounded-xl border border-slate-200">
              <p className="text-3xl mb-3">📋</p>
              <p className="text-slate-400 text-sm mb-3">No templates yet.</p>
              <button onClick={openNewTemplate} className="text-[#1F4E79] text-sm font-semibold hover:underline">+ Create the first template</button>
            </div>
          ) : (
            <div className="space-y-3">
              {templates.map(t => (
                <div key={t.id} className={`bg-white border rounded-2xl p-5 transition-opacity ${!t.is_active ? 'opacity-50' : ''}`}>
                  <div className="flex items-start gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1 flex-wrap">
                        <p className="font-semibold text-slate-800">{t.title}</p>
                        <span className="text-[10px] font-semibold bg-purple-100 text-purple-700 px-2 py-0.5 rounded-full">
                          Phase {String(t.phase_number).padStart(2, '0')}
                        </span>
                        {t.industry && (
                          <span className="text-[10px] font-medium bg-amber-50 text-amber-700 border border-amber-100 px-2 py-0.5 rounded-full">
                            {industries.find(i => i.code === t.industry)?.icon} {t.industry}
                          </span>
                        )}
                        {t.role && (
                          <span className="text-[10px] font-medium bg-slate-100 text-slate-600 px-2 py-0.5 rounded-full">
                            {roles.find(r => r.code === t.role)?.label ?? t.role}
                          </span>
                        )}
                        {!t.is_active && (
                          <span className="text-[10px] bg-slate-100 text-slate-400 px-2 py-0.5 rounded-full font-semibold">Inactive</span>
                        )}
                      </div>
                      {t.description && <p className="text-xs text-slate-500 mb-2">{t.description}</p>}
                      {/* Column preview pills */}
                      <div className="flex flex-wrap gap-1.5 mt-2">
                        {(t.columns ?? []).map((col, i) => (
                          <span key={i} className="text-[10px] font-medium bg-slate-50 border border-slate-200 text-slate-600 px-2 py-0.5 rounded-full">
                            {col.label}
                            <span className="text-slate-400 ml-1">({col.type})</span>
                          </span>
                        ))}
                      </div>
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                      <button onClick={() => toggleTemplateActive(t)}
                        className={`text-xs font-semibold px-3 py-1 rounded-lg border transition-colors ${
                          t.is_active
                            ? 'text-slate-400 border-slate-200 hover:border-slate-300'
                            : 'text-green-600 border-green-200 hover:bg-green-50'
                        }`}>
                        {t.is_active ? 'Deactivate' : 'Activate'}
                      </button>
                      <button onClick={() => openEditTemplate(t)} className="text-xs text-[#1F4E79] hover:underline">Edit</button>
                      <button onClick={() => handleTemplateDelete(t.id)} className="text-xs text-red-400 hover:underline">Delete</button>
                    </div>
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
                    {industries.map(i => <option key={i.code} value={i.code}>{i.icon} {i.label}</option>)}
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

              {/* Linked Template */}
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1">
                  Linked Template <span className="font-normal text-slate-400">(optional — embeds interactive table in user's drawer)</span>
                </label>
                <select
                  value={form.template_id}
                  onChange={e => setForm({...form, template_id: e.target.value})}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#1F4E79]"
                >
                  <option value="">No template linked</option>
                  {templates
                    .filter(t => t.phase_number === form.phase_number && t.is_active)
                    .map(t => (
                      <option key={t.id} value={t.id}>
                        📋 {t.title}
                        {t.industry ? ` · ${t.industry}` : ''}
                        {t.role ? ` · ${t.role}` : ''}
                      </option>
                    ))
                  }
                </select>
                {form.template_id && (
                  <p className="text-[10px] text-[#1F4E79] mt-1">
                    ✓ Users will see the {templates.find(t => t.id === form.template_id)?.title} table embedded in this item's drawer.
                  </p>
                )}
              </div>

              {/* Template-only fields */}
              {form.content_type === 'template' && (
                <>
                  <div>
                    <label className="block text-xs font-semibold text-slate-600 mb-1">
                      Template Body <span className="font-normal text-slate-400">(content shown to users)</span>
                    </label>
                    <textarea value={form.body} onChange={e => setForm({...form, body: e.target.value})}
                      placeholder="Write the full template content here. Use plain text or markdown-style headings (e.g. ## Section Name). Users will see this in the drawer and can copy or work from it."
                      rows={8} className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm resize-none focus:outline-none focus:border-[#1F4E79] font-mono" />
                    <p className="text-[10px] text-slate-400 mt-1">Use ## for headings, - for bullet points, **bold** for emphasis.</p>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-600 mb-1">
                      Download URL <span className="font-normal text-slate-400">(optional — Google Drive, SharePoint, Dropbox link)</span>
                    </label>
                    <input value={form.file_url} onChange={e => setForm({...form, file_url: e.target.value})}
                      placeholder="https://docs.google.com/..."
                      className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#1F4E79]" />
                  </div>
                </>
              )}

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
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-2">Icon</label>
                <div className="flex gap-2 flex-wrap">
                  {ROLE_ICON_OPTIONS.map(icon => (
                    <button key={icon} onClick={() => setRoleForm({...roleForm, icon})}
                      className={`w-9 h-9 text-xl rounded-lg border-2 transition-all ${
                        roleForm.icon === icon ? 'border-[#1F4E79] bg-[#1F4E79]/5' : 'border-slate-200 hover:border-slate-300'
                      }`}>
                      {icon}
                    </button>
                  ))}
                </div>
              </div>
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
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#1F4E79] disabled:bg-slate-50 disabled:text-slate-400" />
                  {roleEditId && <p className="text-[10px] text-slate-400 mt-1">Code cannot be changed after creation</p>}
                </div>
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1">Short Description <span className="font-normal text-slate-400">(shown on card)</span></label>
                <input value={roleForm.description} onChange={e => setRoleForm({...roleForm, description: e.target.value})}
                  placeholder="e.g. Vision, sponsorship & decision authority"
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#1F4E79]" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1">Detail <span className="font-normal text-slate-400">(longer explanation on card)</span></label>
                <textarea value={roleForm.detail} onChange={e => setRoleForm({...roleForm, detail: e.target.value})}
                  placeholder="Describe what this role does in a change programme..."
                  rows={2} className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm resize-none focus:outline-none focus:border-[#1F4E79]" />
              </div>
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

      {/* ── INDUSTRY FORM MODAL ── */}
      {showIndustryForm && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg">
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
              <h2 className="font-semibold text-slate-800">{industryEditId ? 'Edit Industry' : 'Add New Industry'}</h2>
              <button onClick={() => setShowIndustryForm(false)} className="text-slate-400 hover:text-slate-600 text-xl leading-none">✕</button>
            </div>
            <div className="px-6 py-5 space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-2">Icon</label>
                <div className="flex gap-2 flex-wrap">
                  {INDUSTRY_ICON_OPTIONS.map(icon => (
                    <button key={icon} onClick={() => setIndustryForm({...industryForm, icon})}
                      className={`w-9 h-9 text-xl rounded-lg border-2 transition-all ${
                        industryForm.icon === icon ? 'border-[#1F4E79] bg-[#1F4E79]/5' : 'border-slate-200 hover:border-slate-300'
                      }`}>
                      {icon}
                    </button>
                  ))}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">Label * <span className="font-normal text-slate-400">(display name)</span></label>
                  <input value={industryForm.label} onChange={e => setIndustryForm({...industryForm, label: e.target.value})}
                    placeholder="e.g. Mining & Resources"
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#1F4E79]" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">Code * <span className="font-normal text-slate-400">(unique, lowercase)</span></label>
                  <input value={industryForm.code} onChange={e => setIndustryForm({...industryForm, code: e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, '')})}
                    placeholder="e.g. mining-resources"
                    disabled={!!industryEditId}
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#1F4E79] disabled:bg-slate-50 disabled:text-slate-400" />
                  {industryEditId && <p className="text-[10px] text-slate-400 mt-1">Code cannot be changed after creation</p>}
                </div>
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1">Framework / Detail <span className="font-normal text-slate-400">(shown on onboarding card)</span></label>
                <input value={industryForm.detail} onChange={e => setIndustryForm({...industryForm, detail: e.target.value})}
                  placeholder="e.g. ADKAR + ISO 31000 + Regulatory"
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#1F4E79]" />
              </div>
              <div className="flex items-center justify-between">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={industryForm.is_active} onChange={e => setIndustryForm({...industryForm, is_active: e.target.checked})}
                    className="w-4 h-4 accent-[#1F4E79]" />
                  <span className="text-sm text-slate-700">Active <span className="text-slate-400 text-xs">(visible in onboarding)</span></span>
                </label>
                <div className="flex items-center gap-2">
                  <label className="text-xs text-slate-500">Order</label>
                  <input type="number" value={industryForm.sort_order} onChange={e => setIndustryForm({...industryForm, sort_order: Number(e.target.value)})}
                    className="w-16 border border-slate-200 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:border-[#1F4E79]" />
                </div>
              </div>
              {industryFormError && <p className="text-sm text-red-500">{industryFormError}</p>}
            </div>
            <div className="px-6 py-4 border-t border-slate-100 flex justify-end gap-3">
              <button onClick={() => setShowIndustryForm(false)} className="text-sm text-slate-500 hover:text-slate-700 px-4 py-2">Cancel</button>
              <button onClick={handleIndustrySave} disabled={industrySaving}
                className="bg-[#1F4E79] text-white text-sm font-semibold px-6 py-2 rounded-lg hover:bg-[#163a5c] transition-colors disabled:opacity-60">
                {industrySaving ? 'Saving…' : industryEditId ? 'Save Changes' : 'Add Industry'}
              </button>
            </div>
          </div>
        </div>
      )}
      {/* ── TEMPLATE FORM MODAL ── */}
      {showTemplateForm && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-start justify-center p-4 overflow-y-auto">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl my-8">
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
              <h2 className="font-semibold text-slate-800">{templateEditId ? 'Edit Template' : 'New Template'}</h2>
              <button onClick={() => setShowTemplateForm(false)} className="text-slate-400 hover:text-slate-600 text-xl leading-none">✕</button>
            </div>

            <div className="px-6 py-5 space-y-4">

              {/* Title */}
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1">Title *</label>
                <input value={templateForm.title} onChange={e => setTemplateForm({...templateForm, title: e.target.value})}
                  placeholder="e.g. Stakeholder Register"
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#1F4E79]" />
              </div>

              {/* Description */}
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1">Description</label>
                <textarea value={templateForm.description} onChange={e => setTemplateForm({...templateForm, description: e.target.value})}
                  placeholder="What is this template for? How should users use it?"
                  rows={2} className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm resize-none focus:outline-none focus:border-[#1F4E79]" />
              </div>

              {/* Phase + Industry + Role */}
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">Phase *</label>
                  <select value={templateForm.phase_number} onChange={e => setTemplateForm({...templateForm, phase_number: Number(e.target.value)})}
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#1F4E79]">
                    {PHASES.map(p => <option key={p.num} value={p.num}>{p.label}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">Industry <span className="text-slate-400 font-normal">(blank = all)</span></label>
                  <select value={templateForm.industry} onChange={e => setTemplateForm({...templateForm, industry: e.target.value})}
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#1F4E79]">
                    <option value="">All industries</option>
                    {industries.map(i => <option key={i.code} value={i.code}>{i.icon} {i.label}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">Role <span className="text-slate-400 font-normal">(blank = all)</span></label>
                  <select value={templateForm.role} onChange={e => setTemplateForm({...templateForm, role: e.target.value})}
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#1F4E79]">
                    <option value="">All roles</option>
                    {roles.map(r => <option key={r.code} value={r.code}>{r.label}</option>)}
                  </select>
                </div>
              </div>

              {/* Download URL */}
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1">
                  Download URL <span className="font-normal text-slate-400">(optional — Google Drive, SharePoint, Dropbox)</span>
                </label>
                <input value={templateForm.file_url} onChange={e => setTemplateForm({...templateForm, file_url: e.target.value})}
                  placeholder="https://docs.google.com/spreadsheets/..."
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#1F4E79]" />
              </div>

              {/* Column Builder */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="block text-xs font-semibold text-slate-600">Columns * <span className="font-normal text-slate-400">(define the table structure)</span></label>
                  <div className="flex gap-2">
                    <input
                      ref={xlsxInputRef}
                      type="file"
                      accept=".xlsx,.xls,.csv"
                      onChange={importFromExcel}
                      className="hidden"
                    />
                    <button
                      onClick={() => xlsxInputRef.current?.click()}
                      className="text-xs font-semibold text-[#E8913A] border border-[#E8913A]/30 px-3 py-1 rounded-lg hover:bg-[#E8913A]/5 transition-colors"
                    >
                      ⬆ Import from Excel
                    </button>
                    <button onClick={addCol} className="text-xs font-semibold text-[#1F4E79] border border-[#1F4E79]/30 px-3 py-1 rounded-lg hover:bg-[#1F4E79]/5 transition-colors">
                      + Add Column
                    </button>
                  </div>
                </div>

                {templateCols.length === 0 ? (
                  <div className="text-center py-6 bg-slate-50 rounded-xl border border-dashed border-slate-300">
                    <p className="text-slate-400 text-xs">No columns yet. Click "+ Add Column" to start building your table.</p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {templateCols.map((col, idx) => (
                      <div key={col._id} className="flex items-start gap-2 bg-slate-50 rounded-xl p-3 border border-slate-200">
                        {/* Reorder */}
                        <div className="flex flex-col gap-0.5 pt-1 shrink-0">
                          <button onClick={() => moveCol(col._id, -1)} disabled={idx === 0}
                            className="text-slate-300 hover:text-slate-500 disabled:opacity-30 text-xs leading-none">▲</button>
                          <button onClick={() => moveCol(col._id, 1)} disabled={idx === templateCols.length - 1}
                            className="text-slate-300 hover:text-slate-500 disabled:opacity-30 text-xs leading-none">▼</button>
                        </div>

                        {/* Label */}
                        <div className="flex-1 min-w-0">
                          <input
                            value={col.label}
                            onChange={e => updateCol(col._id, 'label', e.target.value)}
                            placeholder="Column name (e.g. Stakeholder Name)"
                            className="w-full border border-slate-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:border-[#1F4E79] bg-white"
                          />
                        </div>

                        {/* Type */}
                        <select value={col.type} onChange={e => updateCol(col._id, 'type', e.target.value)}
                          className="border border-slate-200 rounded-lg px-2 py-1.5 text-xs text-slate-700 focus:outline-none focus:border-[#1F4E79] bg-white shrink-0">
                          {COLUMN_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                        </select>

                        {/* Required */}
                        <label className="flex items-center gap-1 shrink-0 cursor-pointer pt-1.5">
                          <input type="checkbox" checked={col.required} onChange={e => updateCol(col._id, 'required', e.target.checked)}
                            className="w-3 h-3 accent-[#1F4E79]" />
                          <span className="text-[10px] text-slate-500">Req</span>
                        </label>

                        {/* Delete */}
                        <button onClick={() => removeCol(col._id)} className="text-slate-300 hover:text-red-400 transition-colors shrink-0 pt-1">✕</button>

                        {/* Options — only for select type */}
                        {col.type === 'select' && (
                          <div className="w-full mt-1.5 ml-6 col-span-full">
                            <input
                              value={col.options}
                              onChange={e => updateCol(col._id, 'options', e.target.value)}
                              placeholder="Options: High, Medium, Low  (comma-separated)"
                              className="w-full border border-slate-200 rounded-lg px-3 py-1.5 text-xs focus:outline-none focus:border-[#1F4E79] bg-white"
                            />
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Active + Order */}
              <div className="flex items-center justify-between">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={templateForm.is_active} onChange={e => setTemplateForm({...templateForm, is_active: e.target.checked})}
                    className="w-4 h-4 accent-[#1F4E79]" />
                  <span className="text-sm text-slate-700">Active <span className="text-slate-400 text-xs">(visible to users on phase pages)</span></span>
                </label>
                <div className="flex items-center gap-2">
                  <label className="text-xs text-slate-500">Order</label>
                  <input type="number" value={templateForm.sort_order} onChange={e => setTemplateForm({...templateForm, sort_order: Number(e.target.value)})}
                    className="w-16 border border-slate-200 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:border-[#1F4E79]" />
                </div>
              </div>

              {templateFormError && <p className="text-sm text-red-500">{templateFormError}</p>}
            </div>

            <div className="px-6 py-4 border-t border-slate-100 flex justify-end gap-3">
              <button onClick={() => setShowTemplateForm(false)} className="text-sm text-slate-500 hover:text-slate-700 px-4 py-2">Cancel</button>
              <button onClick={handleTemplateSave} disabled={templateSaving}
                className="bg-[#1F4E79] text-white text-sm font-semibold px-6 py-2 rounded-lg hover:bg-[#163a5c] transition-colors disabled:opacity-60">
                {templateSaving ? 'Saving…' : templateEditId ? 'Save Changes' : 'Create Template'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
