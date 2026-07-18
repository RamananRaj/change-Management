// ChangeFlow · searchable client picker (typeahead combobox)
//
// Scales past a plain <select> when there are many clients: type a few letters and pick.
// Controlled by `value` (a client id, or one of the special option values). `specials` are
// fixed rows rendered above the client list (e.g. "All scopes", "🌐 Shared library").
//
//   <ClientPicker value={v} onChange={setV} clients={clients}
//     specials={[{ value: '', label: 'All scopes' }, { value: '__global', label: '🌐 Shared library' }]} />

import { useState, useRef, useEffect } from 'react'

export default function ClientPicker({
  value, onChange, clients = [], specials = [],
  placeholder = 'Search client…', className = '',
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const boxRef = useRef(null)

  // Close on outside click.
  useEffect(() => {
    if (!open) return
    const onDoc = e => { if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])

  const selectedLabel =
    specials.find(s => s.value === value)?.label ??
    (clients.find(c => c.id === value)?.name ? `🏢 ${clients.find(c => c.id === value).name}` : placeholder)

  const q = query.trim().toLowerCase()
  const matches = q ? clients.filter(c => c.name.toLowerCase().includes(q)) : clients

  function pick(v) { onChange(v); setOpen(false); setQuery('') }

  return (
    <div ref={boxRef} className={`relative ${className}`}>
      <button type="button" onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between gap-2 border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-700 bg-white focus:outline-none focus:border-[#1F4E79]">
        <span className="truncate">{selectedLabel}</span>
        <span className="text-slate-400 text-xs">▾</span>
      </button>

      {open && (
        <div className="absolute z-50 mt-1 w-full min-w-[220px] bg-white border border-slate-200 rounded-xl shadow-xl overflow-hidden">
          <div className="p-2 border-b border-slate-100">
            <input autoFocus value={query} onChange={e => setQuery(e.target.value)} placeholder={placeholder}
              className="w-full border border-slate-200 rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:border-[#1F4E79]" />
          </div>
          <div className="max-h-64 overflow-y-auto py-1">
            {!q && specials.map(s => (
              <button type="button" key={s.value || '__all'} onClick={() => pick(s.value)}
                className={`w-full text-left px-3 py-2 text-sm hover:bg-slate-50 ${s.value === value ? 'text-[#1F4E79] font-semibold' : 'text-slate-700'}`}>
                {s.value === value ? '✓ ' : ''}{s.label}
              </button>
            ))}
            {!q && specials.length > 0 && <div className="h-px bg-slate-100 my-1" />}
            {matches.length === 0
              ? <p className="px-3 py-3 text-xs text-slate-400">No clients match “{query}”.</p>
              : matches.map(c => (
                <button type="button" key={c.id} onClick={() => pick(c.id)}
                  className={`w-full text-left px-3 py-2 text-sm hover:bg-slate-50 ${c.id === value ? 'text-[#1F4E79] font-semibold' : 'text-slate-700'}`}>
                  {c.id === value ? '✓ ' : ''}🏢 {c.name}
                </button>
              ))}
          </div>
        </div>
      )}
    </div>
  )
}
