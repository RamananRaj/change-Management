import { useEffect, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../lib/supabase'
import AdminClients from '../components/AdminClients'
import SystemAdmin from '../components/SystemAdmin'

export default function ClientAdmin() {
  const { profile } = useAuth()
  const [roles, setRoles] = useState([])
  const [view, setView]   = useState('Programme')   // 'Programme' | 'Users'

  useEffect(() => {
    supabase.from('roles').select('*').order('sort_order').then(({ data }) => setRoles(data ?? []))
  }, [])

  if (!profile?.is_client_admin) {
    return <div className="p-8 text-center text-slate-500">You don't have permission to access this page.</div>
  }
  if (!profile?.client_id) {
    return <div className="p-8 text-center text-slate-500">Your account isn't linked to a client yet — ask your administrator to assign you.</div>
  }

  return (
    <div className="p-8">
      <p className="text-xs font-semibold text-slate-400 uppercase tracking-widest">Client Admin</p>
      <h1 className="text-2xl font-bold text-slate-800 mb-4">Manage your programme</h1>

      <div className="flex gap-1 bg-slate-100 rounded-xl p-1 mb-6 w-fit">
        {['Programme', 'Users'].map(v => (
          <button key={v} onClick={() => setView(v)}
            className={`px-4 py-1.5 rounded-lg text-sm font-semibold transition-colors ${view === v ? 'bg-white text-[#1F4E79] shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>
            {v}
          </button>
        ))}
      </div>

      {view === 'Programme'
        ? <AdminClients lockedClientId={profile.client_id} allRoles={roles} />
        : <SystemAdmin allRoles={roles} clientId={profile.client_id} />}
    </div>
  )
}
