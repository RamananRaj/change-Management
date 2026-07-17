import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

// Live "who's online" via Supabase Realtime Presence — no table, no SQL. Each signed-in
// client joins a shared channel and tracks a little metadata; everyone gets the synced list.
// Note: single global channel for now (Master Admin sees all). Scope by client_id later if
// cross-tenant visibility becomes a concern.
export function usePresence(user, profile) {
  const [online, setOnline] = useState([])

  useEffect(() => {
    if (!user?.id) return
    const meta = {
      name: profile?.full_name ?? 'User',
      initials: (profile?.full_name || '?').split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2),
      role: profile?.is_admin ? 'Master Admin' : profile?.is_client_admin ? 'Client Admin' : (profile?.role ? profile.role.toUpperCase() : 'Member'),
    }
    const channel = supabase.channel('presence:online', { config: { presence: { key: user.id } } })
    channel
      .on('presence', { event: 'sync' }, () => {
        const state = channel.presenceState()
        setOnline(Object.entries(state).map(([id, metas]) => ({ id, ...(metas[0] || {}) })))
      })
      .subscribe(status => { if (status === 'SUBSCRIBED') channel.track(meta) })

    return () => { supabase.removeChannel(channel) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, profile?.full_name])

  return online
}
