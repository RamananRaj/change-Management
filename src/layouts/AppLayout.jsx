import { useState } from 'react'
import { Outlet, NavLink, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { usePresence } from '../hooks/usePresence'
import SolutionBoard from '../components/SolutionBoard'
import CFM from '../components/CFM'

// Full-page layout. No left rail — content uses the whole width. Navigation lives in two
// places: a slim top bar (brand + admin + user/logout, top-right as icons) and a floating
// action button (bottom-right) that expands to the phase journey + quick links. The phase
// list is data-driven, so trimming 5 → 3 later needs no layout change.
const phases = [
  { path: '/phases/diagnose', label: 'Diagnose', n: '01' },
  { path: '/phases/design',   label: 'Design',   n: '02' },
  { path: '/phases/engage',   label: 'Engage',   n: '03' },
  { path: '/phases/embed',    label: 'Embed',    n: '04' },
  { path: '/phases/evaluate', label: 'Evaluate', n: '05' },
]

export default function AppLayout() {
  const { user, profile, signOut } = useAuth()
  const navigate = useNavigate()
  const online = usePresence(user, profile)
  const [fabOpen, setFabOpen]   = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)

  const initials = profile?.full_name
    ? profile.full_name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2)
    : '?'

  const go = path => { navigate(path); setFabOpen(false) }

  // Quick-nav shown in the FAB: the journey phases, plus Dashboard and the AI Canvas.
  // Master Admins also get "View as member" (the preview picker + persona mode).
  const fabItems = [
    { label: 'Dashboard', path: '/dashboard', bg: '#334155', glyph: '⬡' },
    ...phases.map(p => ({ label: p.label, path: p.path, bg: '#1F4E79', glyph: p.n })),
    { label: 'AI Canvas', path: '/canvas', bg: '#E8913A', glyph: '✦' },
    ...(profile?.is_admin ? [{ label: 'View as member', path: '/admin/preview', bg: '#7C3AED', glyph: '⤢' }] : []),
  ]

  const TopIcon = ({ to, title, children }) => (
    <NavLink to={to} title={title}
      className={({ isActive }) => `w-9 h-9 rounded-lg flex items-center justify-center transition-colors ${isActive ? 'bg-[#1F4E79] text-white' : 'text-slate-500 hover:bg-slate-100'}`}>
      {children}
    </NavLink>
  )

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Top bar */}
      <header className="sticky top-0 z-30 bg-white border-b border-slate-200 h-14 px-5 flex items-center gap-3">
        <NavLink to="/dashboard" className="flex items-center gap-2 font-extrabold tracking-wide text-[#1F4E79]">
          <span className="w-7 h-7 rounded-lg bg-[#1F4E79] text-white flex items-center justify-center text-sm">◆</span>
          <span className="hidden sm:inline">CHANGEFLOW</span>
        </NavLink>

        <div className="ml-auto flex items-center gap-1.5">
          {/* Presence — who's online (foundation for chat/comments later) */}
          {online.length > 0 && (
            <div className="relative group flex items-center mr-1">
              <div className="flex -space-x-2 items-center">
                {online.slice(0, 4).map(u => (
                  <span key={u.id} title={u.name}
                    className="relative w-8 h-8 rounded-full bg-[#1F4E79] text-white text-[11px] font-bold flex items-center justify-center ring-2 ring-white">
                    {u.initials}
                    <span className="absolute bottom-0 right-0 w-2.5 h-2.5 bg-green-500 rounded-full ring-2 ring-white" />
                  </span>
                ))}
                {online.length > 4 && (
                  <span className="w-8 h-8 rounded-full bg-slate-200 text-slate-600 text-[11px] font-bold flex items-center justify-center ring-2 ring-white">+{online.length - 4}</span>
                )}
              </div>
              {/* Hover tooltip: who's online */}
              <div className="absolute right-0 top-11 hidden group-hover:block bg-white shadow-xl border border-slate-100 rounded-xl p-3 w-60 z-50">
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2">Online now · {online.length}</p>
                <div className="space-y-1.5 max-h-64 overflow-y-auto">
                  {online.map(u => (
                    <div key={u.id} className="flex items-center gap-2">
                      <span className="w-2 h-2 bg-green-500 rounded-full shrink-0" />
                      <span className="text-sm text-slate-700 truncate">{u.name}</span>
                      {u.role && <span className="ml-auto text-[10px] text-slate-400 shrink-0">{u.role}</span>}
                    </div>
                  ))}
                </div>
              </div>
              <div className="w-px h-6 bg-slate-200 mx-2" />
            </div>
          )}
          <TopIcon to="/dashboard" title="Dashboard">
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M9 22V12h6v10"/></svg>
          </TopIcon>
          {profile?.is_admin && (
            <TopIcon to="/admin" title="Platform Admin">
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
            </TopIcon>
          )}
          {profile?.is_client_admin && (
            <TopIcon to="/client-admin" title="Client Admin">
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 21h18"/><path d="M5 21V7l8-4v18"/><path d="M19 21V11l-6-4"/></svg>
            </TopIcon>
          )}

          {/* User menu */}
          <div className="relative ml-1">
            <button onClick={() => setMenuOpen(o => !o)}
              className="w-9 h-9 rounded-full bg-[#E8913A] text-white text-xs font-bold flex items-center justify-center">
              {initials}
            </button>
            {menuOpen && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setMenuOpen(false)} />
                <div className="absolute right-0 mt-2 w-56 bg-white rounded-xl shadow-lg border border-slate-100 z-50 overflow-hidden">
                  <div className="px-4 py-3 border-b border-slate-100">
                    <p className="text-sm font-semibold text-slate-800 truncate">{profile?.full_name ?? 'User'}</p>
                    <p className="text-[11px] text-slate-400 truncate">{profile?.role?.toUpperCase() ?? ''}{profile?.is_admin ? ' · Master Admin' : profile?.is_client_admin ? ' · Client Admin' : ''}</p>
                  </div>
                  {profile?.is_admin && <button onClick={() => { setMenuOpen(false); navigate('/admin') }} className="w-full text-left px-4 py-2.5 text-sm text-slate-600 hover:bg-slate-50">Platform Admin</button>}
                  {profile?.is_client_admin && <button onClick={() => { setMenuOpen(false); navigate('/client-admin') }} className="w-full text-left px-4 py-2.5 text-sm text-slate-600 hover:bg-slate-50">Client Admin</button>}
                  <button onClick={signOut} className="w-full text-left px-4 py-2.5 text-sm text-red-500 hover:bg-red-50 border-t border-slate-100">Sign out →</button>
                </div>
              </>
            )}
          </div>
        </div>
      </header>

      {/* Full-width content */}
      <main className="w-full">
        <Outlet />
      </main>

      {/* Floating action button — phase journey + quick nav */}
      <div className="fixed bottom-6 right-6 z-40 flex flex-col items-end gap-3">
        {fabOpen && (
          <div className="flex flex-col items-end gap-2.5 mb-1">
            {fabItems.map(item => (
              <button key={item.path} onClick={() => go(item.path)} className="flex items-center gap-3 group">
                <span className="bg-white rounded-xl px-4 py-2 shadow-md text-sm font-semibold text-slate-700 group-hover:text-[#1F4E79] transition-colors">{item.label}</span>
                <span className="w-11 h-11 rounded-full flex items-center justify-center shadow-md text-white font-bold text-sm shrink-0" style={{ background: item.bg }}>{item.glyph}</span>
              </button>
            ))}
          </div>
        )}
        <button onClick={() => setFabOpen(o => !o)} aria-label="Navigation"
          className="w-14 h-14 rounded-full bg-[#1F4E79] text-white shadow-lg flex items-center justify-center hover:bg-[#163a5c] transition-all">
          {fabOpen
            ? <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>
            : <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M4 6h16M4 12h16M4 18h16"/></svg>}
        </button>
      </div>

      <SolutionBoard />
      <CFM />
    </div>
  )
}
