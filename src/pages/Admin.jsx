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

const ROLES = [
  { value: 'cm', label: 'Change Manager' },
  { value: 'po', label: 'Product Owner' },
  { value: 'pm', label: 'Project Manager' },
]

const CONTENT_TYPES = [
  { value: 'exercise', label: 'Exercise' },
  { value: 'tool',     label: 'Tool' },
  { value: 'template', label: 'Template' },
]

const SECTIONS = ['Content Manager', 'Phase Manager', 'Role Manager']

const emptyForm = {
  phase_number: 1,
  industry: '',
  role: '',
  content_type: 'exercise',
  title: '',
  description: '',
  is_common: true,
  sort_order: 0,
}

export default function Admin() {
  const { profile } = useAuth()
  const [section, setSection] = useState('Content Manager')

  // Filters
  const [filterPhase,    setFilterPhase]    = useState(1)
  const [filterIndustry, setFilterIndustry] = useState('')
  const [filterRole,     setFilterRole]     = useState('')

  // Content list
  const [items,   setItems]   = useState([])
  const [loading, setLoading] = useState(false)

  // Phase manager
  const [userPhases,    setUserPhases]    = useState([])  // [{ user, project, phases[] }]
  const [phaseLoading,  setPhaseLoading]  = useState(false)
  const [unlocking,     setUnlocking]     = useState(null) // phase row id being unlocked

  // Form
  const [showForm,  setShowForm]  = useState(false)
  const [form,      setForm]      = useState(emptyForm)
  const [editId,    setEditId]    = useState(null)
  const [saving,    setSaving]    = useState(false)
  const [formError, setFormError] = useState(null)

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
    if (section === 'Phase Manager')   fetchUserPhases()
  }, [section, filterPhase, filterIndustry, filterRole])

  async function fetchItems() {
    setLoading(true)
    let query = supabase
      .from('phase_content')
      .select('*')
      .eq('phase_number', filterPhase)
      .order('sort_order', { ascending: true })

    if (filterIndustry) query = query.eq('industry', filterIndustry)
    if (filterRole)     query = query.eq('role', filterRole)

    const { data } = await query
    setItems(data ?? [])
    setLoading(false)
  }

  async function fetchUserPhases() {
    setPhaseLoading(true)
    // Fetch all projects with their phases and user profile
    const { data: projects } = await supabase
      .from('projects')
      .select('id, name, user_id, current_phase, created_at, profiles(full_name, role, industry)')
      .order('created_at', { ascending: true })

    if (!projects) { setPhaseLoading(false); return }

    // For each project, fetch its phases
    const enriched = await Promise.all(projects.map(async proj => {
      const { data: phases } = await supabase
        .from('project_phases')
        .select('*')
        .eq('project_id', proj.id)
        .order('phase_number', { ascending: true })
      return { ...proj, phases: phases ?? [] }
    }))

    setUserPhases(enriched)
    setPhaseLoading(false)
  }

  async function unlockPhase(projectId, phaseNumber) {
    const rowKey = `${projectId}-${phaseNumber}`
    setUnlocking(rowKey)
    await supabase
      .from('project_phases')
      .update({ status: 'active' })
      .eq('project_id', projectId)
      .eq('phase_number', phaseNumber)
    await fetchUserPhases()
    setUnlocking(null)
  }

  async function lockPhase(projectId, phaseNumber) {
    const rowKey = `${projectId}-${phaseNumber}`
    setUnlocking(rowKey)
    await supabase
      .from('project_phases')
      .update({ status: 'locked' })
      .eq('project_id', projectId)
      .eq('phase_number', phaseNumber)
    await fetchUserPhases()
    setUnlocking(null)
  }

  function openNew() {
    setForm({ ...emptyForm, phase_number: filterPhase, industry: filterIndustry, role: filterRole })
    setEditId(null)
    setFormError(null)
    setShowForm(true)
  }

  function openEdit(item) {
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

  async function handleSave() {
    if (!form.title.trim()) { setFormError('Title is required'); return }
    setSaving(true)
    const payload = {
      ...form,
      industry: form.industry || null,
      role:     form.role     || null,
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

  async function handleDelete(id) {
    if (!window.confirm('Delete this item?')) return
    await supabase.from('phase_content').delete().eq('id', id)
    fetchItems()
  }

  const typeColor = { exercise: 'bg-blue-100 text-blue-700', tool: 'bg-green-100 text-green-700', template: 'bg-purple-100 text-purple-700' }

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
          <button
            key={s}
            onClick={() => setSection(s)}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              section === s
                ? 'border-[#1F4E79] text-[#1F4E79]'
                : 'border-transparent text-slate-500 hover:text-slate-700'
            }`}
          >
            {s}
          </button>
        ))}
      </div>

      {/* ── CONTENT MANAGER ── */}
      {section === 'Content Manager' && (
        <div>
          {/* Filters */}
          <div className="flex flex-wrap gap-3 mb-6">
            <div>
              <label className="block text-[10px] font-semibold text-slate-500 uppercase mb-1">Phase</label>
              <select
                value={filterPhase}
                onChange={e => setFilterPhase(Number(e.target.value))}
                className="border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-700 focus:outline-none focus:border-[#1F4E79]"
              >
                {PHASES.map(p => <option key={p.num} value={p.num}>{p.label}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-[10px] font-semibold text-slate-500 uppercase mb-1">Industry</label>
              <select
                value={filterIndustry}
                onChange={e => setFilterIndustry(e.target.value)}
                className="border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-700 focus:outline-none focus:border-[#1F4E79]"
              >
                <option value="">All industries</option>
                {INDUSTRIES.map(i => <option key={i.value} value={i.value}>{i.label}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-[10px] font-semibold text-slate-500 uppercase mb-1">Role</label>
              <select
                value={filterRole}
                onChange={e => setFilterRole(e.target.value)}
                className="border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-700 focus:outline-none focus:border-[#1F4E79]"
              >
                <option value="">All roles</option>
                {ROLES.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
              </select>
            </div>
            <div className="flex items-end">
              <button
                onClick={openNew}
                className="bg-[#E8913A] text-white text-sm font-semibold px-4 py-2 rounded-lg hover:bg-[#d07e2e] transition-colors"
              >
                + Add Content
              </button>
            </div>
          </div>

          {/* Content list */}
          {loading ? (
            <p className="text-sm text-slate-400">Loading…</p>
          ) : items.length === 0 ? (
            <div className="text-center py-16 bg-slate-50 rounded-xl border border-slate-200">
              <p className="text-slate-400 text-sm mb-3">No content yet for this selection.</p>
              <button onClick={openNew} className="text-[#1F4E79] text-sm font-semibold hover:underline">
                + Add the first item
              </button>
            </div>
          ) : (
            <div className="space-y-2">
              {items.map(item => (
                <div key={item.id} className="flex items-start gap-4 bg-white border border-slate-200 rounded-xl p-4">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${typeColor[item.content_type]}`}>
                        {item.content_type}
                      </span>
                      {!item.is_common && (
                        <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-amber-100 text-amber-700">
                          Add-on
                        </span>
                      )}
                      {item.industry && (
                        <span className="text-[10px] text-slate-400">{item.industry}</span>
                      )}
                      {item.role && (
                        <span className="text-[10px] text-slate-400">· {item.role.toUpperCase()}</span>
                      )}
                    </div>
                    <p className="font-medium text-slate-800 text-sm">{item.title}</p>
                    {item.description && (
                      <p className="text-xs text-slate-500 mt-0.5 leading-relaxed">{item.description}</p>
                    )}
                  </div>
                  <div className="flex gap-2 shrink-0">
                    <button onClick={() => openEdit(item)} className="text-xs text-[#1F4E79] hover:underline">Edit</button>
                    <button onClick={() => handleDelete(item.id)} className="text-xs text-red-400 hover:underline">Delete</button>
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
            Open or lock any phase for any user. Users see a preview of locked phases and are nudged to complete the current one first.
          </p>

          {phaseLoading ? (
            <p className="text-sm text-slate-400">Loading users…</p>
          ) : userPhases.length === 0 ? (
            <p className="text-sm text-slate-400">No projects found.</p>
          ) : (
            <div className="space-y-6">
              {userPhases.map(proj => {
                const userName    = proj.profiles?.full_name ?? 'Unknown'
                const userRole    = ROLES.find(r => r.value === proj.profiles?.role)?.label ?? proj.profiles?.role ?? '—'
                const userIndustry = INDUSTRIES.find(i => i.value === proj.profiles?.industry)?.label ?? proj.profiles?.industry ?? '—'

                return (
                  <div key={proj.id} className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
                    {/* User header */}
                    <div className="flex items-center gap-3 px-5 py-4 border-b border-slate-100 bg-slate-50">
                      <div className="w-8 h-8 rounded-full bg-[#1F4E79] flex items-center justify-center text-white text-xs font-bold shrink-0">
                        {userName.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2)}
                      </div>
                      <div>
                        <p className="font-semibold text-slate-800 text-sm">{userName}</p>
                        <p className="text-xs text-slate-400">{userRole} · {userIndustry}</p>
                      </div>
                    </div>

                    {/* Phase rows */}
                    <div className="divide-y divide-slate-50">
                      {proj.phases.map(phase => {
                        const cfg    = PHASES.find(p => p.num === phase.phase_number)
                        const rowKey = `${proj.id}-${phase.phase_number}`
                        const busy   = unlocking === rowKey

                        return (
                          <div key={phase.phase_number} className="flex items-center gap-4 px-5 py-3">
                            <span className="text-xs font-bold text-slate-400 w-14 shrink-0">{cfg?.label}</span>

                            {/* Status badge */}
                            <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full shrink-0 ${
                              phase.status === 'completed'
                                ? 'bg-green-100 text-green-700'
                                : phase.status === 'active'
                                  ? 'bg-blue-100 text-blue-700'
                                  : 'bg-slate-100 text-slate-400'
                            }`}>
                              {phase.status === 'completed' ? '✓ Completed' : phase.status === 'active' ? '● Active' : '○ Locked'}
                            </span>

                            <div className="flex-1" />

                            {/* Admin controls */}
                            {phase.status === 'locked' && (
                              <button
                                onClick={() => unlockPhase(proj.id, phase.phase_number)}
                                disabled={busy}
                                className="text-xs font-semibold text-[#1F4E79] border border-[#1F4E79]/30 hover:bg-[#1F4E79]/5 px-3 py-1 rounded-lg transition-colors disabled:opacity-50"
                              >
                                {busy ? 'Opening…' : '🔓 Open for user'}
                              </button>
                            )}
                            {phase.status === 'active' && (
                              <button
                                onClick={() => lockPhase(proj.id, phase.phase_number)}
                                disabled={busy}
                                className="text-xs font-semibold text-slate-400 border border-slate-200 hover:border-slate-300 px-3 py-1 rounded-lg transition-colors disabled:opacity-50"
                              >
                                {busy ? 'Locking…' : '🔒 Lock'}
                              </button>
                            )}
                            {phase.status === 'completed' && (
                              <span className="text-xs text-slate-300">—</span>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}

      {/* ── ROLE MANAGER ── */}
      {section === 'Role Manager' && (
        <div className="space-y-3">
          <p className="text-sm text-slate-500 mb-4">These are the roles users can select during onboarding. Role-specific content is managed in the Content Manager.</p>
          {ROLES.map(r => (
            <div key={r.value} className="flex items-center justify-between bg-white border border-slate-200 rounded-xl px-5 py-4">
              <div>
                <p className="font-medium text-slate-800 text-sm">{r.label}</p>
                <p className="text-xs text-slate-400 mt-0.5">Code: <code className="bg-slate-100 px-1 rounded">{r.value}</code></p>
              </div>
              <span className="text-xs text-green-600 bg-green-50 px-2 py-1 rounded-full font-medium">Active</span>
            </div>
          ))}
          <p className="text-xs text-slate-400 mt-4">Additional roles can be added in a future update.</p>
        </div>
      )}

      {/* ── FORM MODAL ── */}
      {showForm && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg">
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
              <h2 className="font-semibold text-slate-800">{editId ? 'Edit Content' : 'Add Content'}</h2>
              <button onClick={() => setShowForm(false)} className="text-slate-400 hover:text-slate-600 text-xl leading-none">✕</button>
            </div>
            <div className="px-6 py-5 space-y-4">
              {/* Phase + Type row */}
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

              {/* Industry + Role row */}
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
                    {ROLES.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
                  </select>
                </div>
              </div>

              {/* Title */}
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1">Title *</label>
                <input value={form.title} onChange={e => setForm({...form, title: e.target.value})}
                  placeholder="e.g. Change Readiness Assessment"
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#1F4E79]" />
              </div>

              {/* Description */}
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1">Description</label>
                <textarea value={form.description} onChange={e => setForm({...form, description: e.target.value})}
                  placeholder="What does this tool/exercise help the user achieve?"
                  rows={3}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm resize-none focus:outline-none focus:border-[#1F4E79]" />
              </div>

              {/* Common toggle + Sort order */}
              <div className="flex items-center justify-between">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={form.is_common} onChange={e => setForm({...form, is_common: e.target.checked})}
                    className="w-4 h-4 accent-[#1F4E79]" />
                  <span className="text-sm text-slate-700">Common <span className="text-slate-400 text-xs">(shown to all — uncheck for add-on)</span></span>
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
              <button onClick={handleSave} disabled={saving}
                className="bg-[#1F4E79] text-white text-sm font-semibold px-6 py-2 rounded-lg hover:bg-[#163a5c] transition-colors disabled:opacity-60">
                {saving ? 'Saving…' : editId ? 'Save Changes' : 'Add Content'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
