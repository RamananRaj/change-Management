import { useState, useEffect, useRef } from 'react'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../lib/supabase'

// Solution Enhancement board — a private product backlog for the two of us only. Gated by email
// in both the UI and RLS. Floating button bottom-left (CFM chat lives bottom-right).
const ALLOW = ['bedi.ujjwal@gmail.com', 'ram.raj@ramraj.com.au']
const STATUSES = [
  { key: 'idea',        label: 'Idea',        cls: 'bg-slate-100 text-slate-600' },
  { key: 'planned',     label: 'Planned',     cls: 'bg-blue-100 text-blue-700' },
  { key: 'in_progress', label: 'In progress', cls: 'bg-amber-100 text-amber-700' },
  { key: 'done',        label: 'Done',        cls: 'bg-green-100 text-green-700' },
]
const stCfg = k => STATUSES.find(s => s.key === k) ?? STATUSES[0]

export default function SolutionBoard() {
  const { user, profile } = useAuth()
  const [open, setOpen] = useState(false)
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(false)
  const [title, setTitle] = useState('')
  const [detail, setDetail] = useState('')
  const [saving, setSaving] = useState(false)
  const [confirmId, setConfirmId] = useState(null)   // in-app delete confirm
  const titleRef = useRef(null)

  const allowed = ALLOW.includes((user?.email || '').toLowerCase())

  useEffect(() => { if (open && allowed) fetchItems() }, [open, allowed])
  useEffect(() => { if (open && titleRef.current) titleRef.current.focus() }, [open])

  if (!allowed) return null

  async function fetchItems() {
    setLoading(true)
    const { data } = await supabase.from('solution_enhancements').select('*').order('created_at', { ascending: false })
    setItems(data ?? [])
    setLoading(false)
  }
  async function add() {
    if (!title.trim()) return
    setSaving(true)
    await supabase.from('solution_enhancements').insert({
      title: title.trim(), detail: detail.trim() || null, status: 'idea',
      created_by: user.id, created_by_name: profile?.full_name ?? user.email,
    })
    setTitle(''); setDetail(''); await fetchItems(); setSaving(false)
  }
  async function setStatus(id, status) {
    await supabase.from('solution_enhancements').update({ status, updated_at: new Date().toISOString() }).eq('id', id)
    setItems(prev => prev.map(i => i.id === id ? { ...i, status } : i))
  }
  async function remove(id) {
    await supabase.from('solution_enhancements').delete().eq('id', id)
    setItems(prev => prev.filter(i => i.id !== id))
    setConfirmId(null)
  }
  const fmt = ts => new Date(ts).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })
  const openCount = items.filter(i => i.status !== 'done').length

  return (
    <>
      <button onClick={() => setOpen(o => !o)} title="Solution enhancements"
        className="fixed bottom-6 left-6 z-40 w-12 h-12 rounded-full bg-[#1F4E79] text-white shadow-lg flex items-center justify-center hover:bg-[#2E75B6] transition-colors">
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
        </svg>
        {openCount > 0 && !open && (
          <span className="absolute -top-1 -right-1 min-w-[20px] h-5 px-1 bg-[#E8913A] rounded-full text-[10px] font-bold flex items-center justify-center">{openCount}</span>
        )}
      </button>

      {open && (
        <div className="fixed bottom-20 left-6 z-40 w-[360px] bg-white rounded-2xl shadow-2xl border border-slate-200 flex flex-col max-h-[72vh]">
          <div className="flex items-center justify-between px-4 py-3 bg-[#1F4E79] rounded-t-2xl">
            <div>
              <p className="text-white font-semibold text-sm">✦ Solution Enhancements</p>
              <p className="text-white/60 text-[10px]">Private backlog · Ujjwal &amp; Ram</p>
            </div>
            <button onClick={() => setOpen(false)} className="text-white/70 hover:text-white text-lg leading-none">✕</button>
          </div>

          <div className="px-4 py-3 border-b border-slate-100 space-y-2">
            <input ref={titleRef} value={title} onChange={e => setTitle(e.target.value)} placeholder="Enhancement title…"
              className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:border-[#1F4E79]" />
            <textarea value={detail} onChange={e => setDetail(e.target.value)} placeholder="Detail (optional)…" rows={2}
              className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 resize-none focus:outline-none focus:border-[#1F4E79]" />
            <button onClick={add} disabled={saving || !title.trim()}
              className="w-full bg-[#E8913A] text-white text-xs font-semibold py-2 rounded-lg hover:bg-[#d07e2e] transition-colors disabled:opacity-50">
              {saving ? 'Adding…' : '+ Add enhancement'}
            </button>
          </div>

          <div className="overflow-y-auto flex-1 px-4 py-3 space-y-2.5">
            {loading ? <p className="text-xs text-slate-400 text-center py-4">Loading…</p>
              : items.length === 0 ? <p className="text-xs text-slate-400 text-center py-4">No enhancements yet.</p>
              : items.map(it => (
                <div key={it.id} className="bg-slate-50 border border-slate-100 rounded-lg p-3 group">
                  <div className="flex items-start gap-2">
                    <p className="text-[13px] font-semibold text-slate-800 flex-1 leading-snug">{it.title}</p>
                    {confirmId === it.id ? (
                      <span className="flex items-center gap-1.5 shrink-0">
                        <button onClick={() => remove(it.id)} className="text-[10px] font-semibold text-white bg-red-500 hover:bg-red-600 px-2 py-0.5 rounded">Delete</button>
                        <button onClick={() => setConfirmId(null)} className="text-[10px] text-slate-400 hover:text-slate-600">Cancel</button>
                      </span>
                    ) : (
                      <button onClick={() => setConfirmId(it.id)} className="text-[10px] text-red-400 hover:text-red-600 opacity-0 group-hover:opacity-100 shrink-0">Delete</button>
                    )}
                  </div>
                  {it.detail && <p className="text-[11.5px] text-slate-500 mt-1 leading-relaxed whitespace-pre-wrap">{it.detail}</p>}
                  <div className="flex items-center gap-2 mt-2">
                    <select value={it.status} onChange={e => setStatus(it.id, e.target.value)}
                      className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border-0 outline-none cursor-pointer ${stCfg(it.status).cls}`}>
                      {STATUSES.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
                    </select>
                    <span className="text-[10px] text-slate-400 ml-auto">{it.created_by_name ?? 'Admin'} · {fmt(it.created_at)}</span>
                  </div>
                </div>
              ))}
          </div>
        </div>
      )}
    </>
  )
}
