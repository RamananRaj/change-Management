import { Outlet, NavLink } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import AdminNotes from '../components/AdminNotes'

const phases = [
  { path: '/phases/diagnose', label: '01 Diagnose' },
  { path: '/phases/design',   label: '02 Design'   },
  { path: '/phases/engage',   label: '03 Engage'   },
  { path: '/phases/embed',    label: '04 Embed'     },
  { path: '/phases/evaluate', label: '05 Evaluate'  },
]

export default function AppLayout() {
  const { profile, signOut } = useAuth()

  const initials = profile?.full_name
    ? profile.full_name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2)
    : '?'

  return (
    <div className="flex min-h-screen bg-slate-50">
      {/* Sidebar */}
      <aside className="w-56 bg-[#1F4E79] text-white flex flex-col shrink-0">
        <div className="px-5 py-6 border-b border-white/10">
          <p className="text-xs font-semibold tracking-widest text-white/50 uppercase mb-1">ChangeFlow</p>
          <NavLink to="/dashboard" className="text-white text-sm font-medium hover:text-[#E8913A] transition-colors">
            Dashboard
          </NavLink>
        </div>

        <nav className="flex-1 px-3 py-4">
          <p className="text-[10px] font-semibold tracking-widest text-white/40 uppercase px-2 mb-2">Phases</p>
          {phases.map(p => (
            <NavLink
              key={p.path}
              to={p.path}
              className={({ isActive }) =>
                `block px-3 py-2 rounded-md text-sm mb-1 transition-colors ${
                  isActive
                    ? 'bg-white/20 text-white font-medium'
                    : 'text-white/70 hover:bg-white/10 hover:text-white'
                }`
              }
            >
              {p.label}
            </NavLink>
          ))}

          {profile?.is_admin && (
            <>
              <p className="text-[10px] font-semibold tracking-widest text-white/40 uppercase px-2 mb-2 mt-6">Admin</p>
              <NavLink
                to="/admin"
                className={({ isActive }) =>
                  `block px-3 py-2 rounded-md text-sm mb-1 transition-colors ${
                    isActive
                      ? 'bg-white/20 text-white font-medium'
                      : 'text-white/70 hover:bg-white/10 hover:text-white'
                  }`
                }
              >
                ⚙️ Platform Admin
              </NavLink>
            </>
          )}
        </nav>

        {/* User section */}
        <div className="px-4 py-4 border-t border-white/10">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-8 h-8 rounded-full bg-[#E8913A] flex items-center justify-center text-white text-xs font-bold shrink-0">
              {initials}
            </div>
            <div className="min-w-0">
              <p className="text-white text-xs font-medium truncate">{profile?.full_name ?? 'User'}</p>
              <p className="text-white/40 text-[10px] truncate">{profile?.role?.toUpperCase() ?? ''}</p>
            </div>
          </div>
          <button
            onClick={signOut}
            className="w-full text-left text-xs text-white/50 hover:text-white transition-colors py-1"
          >
            Sign out →
          </button>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-auto">
        <Outlet />
      </main>

      <AdminNotes />
    </div>
  )
}
