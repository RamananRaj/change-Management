import { useState, useEffect, useRef } from 'react'
import { useLocation } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../lib/supabase'

export default function AdminNotes() {
  const { profile } = useAuth()
  const location = useLocation()
  const [open, setOpen] = useState(false)
  const [notes, setNotes] = useState([])
  const [newNote, setNewNote] = useState('')
  const [saving, setSaving] = useState(false)
  const [loading, setLoading] = useState(false)
  const textareaRef = useRef(null)

  const pageSlug = location.pathname

  // Only render for admins
  if (!profile?.is_admin) return null

  // eslint-disable-next-line react-hooks/rules-of-hooks
  useEffect(() => {
    if (!open) return
    fetchNotes()
  }, [open, pageSlug])

  // eslint-disable-next-line react-hooks/rules-of-hooks
  useEffect(() => {
    if (open && textareaRef.current) {
      textareaRef.current.focus()
    }
  }, [open])

  async function fetchNotes() {
    setLoading(true)
    const { data } = await supabase
      .from('page_notes')
      .select('*, profiles(full_name)')
      .eq('page_slug', pageSlug)
      .order('created_at', { ascending: false })
    setNotes(data ?? [])
    setLoading(false)
  }

  async function handleSave() {
    if (!newNote.trim()) return
    setSaving(true)
    await supabase.from('page_notes').insert({
      admin_id:  profile.id,
      page_slug: pageSlug,
      note_text: newNote.trim(),
    })
    setNewNote('')
    await fetchNotes()
    setSaving(false)
  }

  async function handleDelete(id) {
    await supabase.from('page_notes').delete().eq('id', id)
    setNotes(prev => prev.filter(n => n.id !== id))
  }

  function formatDate(ts) {
    return new Date(ts).toLocaleDateString('en-AU', {
      day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit'
    })
  }

  return (
    <>
      {/* Floating button */}
      <button
        onClick={() => setOpen(o => !o)}
        title="Admin Notes"
        className="fixed bottom-6 right-6 z-50 w-12 h-12 rounded-full bg-[#1F4E79] text-white shadow-lg flex items-center justify-center hover:bg-[#2E75B6] transition-colors"
      >
        <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
            d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
        </svg>
        {notes.length > 0 && !open && (
          <span className="absolute -top-1 -right-1 w-5 h-5 bg-[#E8913A] rounded-full text-[10px] font-bold flex items-center justify-center">
            {notes.length}
          </span>
        )}
      </button>

      {/* Notes panel */}
      {open && (
        <div className="fixed bottom-20 right-6 z-50 w-80 bg-white rounded-2xl shadow-2xl border border-slate-200 flex flex-col max-h-[70vh]">
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100 bg-[#1F4E79] rounded-t-2xl">
            <div>
              <p className="text-white font-semibold text-sm">Admin Notes</p>
              <p className="text-white/60 text-[10px] truncate">{pageSlug}</p>
            </div>
            <button onClick={() => setOpen(false)} className="text-white/70 hover:text-white text-lg leading-none">✕</button>
          </div>

          {/* New note input */}
          <div className="px-4 py-3 border-b border-slate-100">
            <textarea
              ref={textareaRef}
              value={newNote}
              onChange={e => setNewNote(e.target.value)}
              placeholder="Add a note about this page…"
              rows={3}
              className="w-full text-sm text-slate-700 border border-slate-200 rounded-lg px-3 py-2 resize-none focus:outline-none focus:border-[#1F4E79] focus:ring-1 focus:ring-[#1F4E79]"
            />
            <button
              onClick={handleSave}
              disabled={saving || !newNote.trim()}
              className="mt-2 w-full bg-[#E8913A] text-white text-xs font-semibold py-2 rounded-lg hover:bg-[#d07e2e] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {saving ? 'Saving…' : 'Save Note'}
            </button>
          </div>

          {/* Notes list */}
          <div className="overflow-y-auto flex-1 px-4 py-3 space-y-3">
            {loading ? (
              <p className="text-xs text-slate-400 text-center py-4">Loading…</p>
            ) : notes.length === 0 ? (
              <p className="text-xs text-slate-400 text-center py-4">No notes for this page yet.</p>
            ) : (
              notes.map(note => (
                <div key={note.id} className="bg-slate-50 rounded-lg p-3 relative group">
                  <p className="text-xs text-slate-700 leading-relaxed whitespace-pre-wrap">{note.note_text}</p>
                  <div className="flex items-center justify-between mt-2">
                    <span className="text-[10px] text-slate-400">
                      {note.profiles?.full_name ?? 'Admin'} · {formatDate(note.created_at)}
                    </span>
                    <button
                      onClick={() => handleDelete(note.id)}
                      className="text-[10px] text-red-400 hover:text-red-600 opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </>
  )
}
