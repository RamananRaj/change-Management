import { useEffect, useState, useCallback, useRef } from 'react'
import { supabase } from '../lib/supabase'

// CFM chat data layer. Loads the signed-in user's channels (DMs + groups), resolves display
// names + unread counts, and keeps them live via a Realtime subscription on chat_messages.
// Master Admin oversight (read-only browse of any client's channels) is exposed separately.
export function useChat(user, profile) {
  const uid = user?.id ?? null
  const [channels, setChannels] = useState([])
  const [people, setPeople]     = useState([])   // people you can start a chat with
  const [loading, setLoading]   = useState(true)
  const chanIds = useRef([])

  const initials = n => (n || '?').split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2)

  const load = useCallback(async () => {
    if (!uid) return
    const { data: mems } = await supabase.from('chat_members').select('channel_id, last_read_at').eq('user_id', uid)
    const ids = (mems ?? []).map(m => m.channel_id)
    chanIds.current = ids
    const lastRead = Object.fromEntries((mems ?? []).map(m => [m.channel_id, m.last_read_at]))

    if (!ids.length) { setChannels([]); setLoading(false); return }

    const [{ data: chans }, { data: allMems }, { data: msgs }] = await Promise.all([
      supabase.from('chat_channels').select('*').in('id', ids),
      supabase.from('chat_members').select('channel_id, user_id').in('channel_id', ids),
      supabase.from('chat_messages').select('channel_id, sender_id, body, created_at').in('channel_id', ids).order('created_at', { ascending: false }).limit(600),
    ])
    const memberUids = [...new Set((allMems ?? []).map(m => m.user_id))]
    const { data: profs } = memberUids.length
      ? await supabase.from('profiles').select('id, full_name, role').in('id', memberUids)
      : { data: [] }
    const profMap = Object.fromEntries((profs ?? []).map(p => [p.id, p]))

    const byChan = {}
    ;(msgs ?? []).forEach(m => { (byChan[m.channel_id] ??= []).push(m) })  // desc order preserved

    const out = (chans ?? []).map(c => {
      const memberIds = (allMems ?? []).filter(m => m.channel_id === c.id).map(m => m.user_id)
      const others = memberIds.filter(id => id !== uid)
      const isGroup = c.type === 'group'
      const name = isGroup ? (c.name || 'Group') : (profMap[others[0]]?.full_name ?? 'Direct message')
      const list = byChan[c.id] ?? []
      const last = list[0] ?? null
      const lr = lastRead[c.id] ? new Date(lastRead[c.id]) : new Date(0)
      const unread = list.filter(m => m.sender_id !== uid && new Date(m.created_at) > lr).length
      return {
        id: c.id, type: c.type, isGroup, name, initials: initials(name),
        members: memberIds, memberProfiles: memberIds.map(id => profMap[id]).filter(Boolean),
        last, unread, lastReadAt: lastRead[c.id],
        lastAt: last ? new Date(last.created_at).getTime() : new Date(c.created_at).getTime(),
      }
    }).sort((a, b) => b.lastAt - a.lastAt)

    setChannels(out)
    setLoading(false)
  }, [uid])

  // People you can start a chat with: your client's members (excl. you); Master Admin can reach
  // client admins + other admins.
  const loadPeople = useCallback(async () => {
    if (!profile) return
    let q = supabase.from('profiles').select('id, full_name, role, is_admin, is_client_admin')
    if (profile.is_admin) q = q.or('is_client_admin.eq.true,is_admin.eq.true')
    else if (profile.client_id) q = q.eq('client_id', profile.client_id)
    else { setPeople([]); return }
    const { data } = await q
    setPeople((data ?? []).filter(p => p.id !== uid))
  }, [profile, uid])

  useEffect(() => { if (uid) { setLoading(true); load(); loadPeople() } }, [uid, load, loadPeople])

  // Realtime: any new message in one of my channels → reload the list (and the open thread reloads
  // via its own effect in the component).
  useEffect(() => {
    if (!uid) return
    const ch = supabase.channel('cfm:messages')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'chat_messages' }, payload => {
        if (chanIds.current.includes(payload.new.channel_id)) load()
      })
      .subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [uid, load])

  const totalUnread = channels.reduce((s, c) => s + c.unread, 0)

  async function loadMessages(channelId) {
    const { data } = await supabase.from('chat_messages').select('*').eq('channel_id', channelId).order('created_at', { ascending: true })
    const msgs = data ?? []
    const paths = msgs.filter(m => m.attachment?.path).map(m => m.attachment.path)
    if (paths.length) {
      const { data: signed } = await supabase.storage.from('chat-attachments').createSignedUrls(paths, 3600)
      const urlMap = Object.fromEntries((signed ?? []).map(s => [s.path, s.signedUrl]))
      msgs.forEach(m => { if (m.attachment?.path) m.attachment.url = urlMap[m.attachment.path] })
    }
    return msgs
  }

  // Upload a file into the channel's folder; returns the metadata to attach to a message.
  async function uploadAttachment(channelId, file) {
    const safe = (file.name || 'file').replace(/[^\w.\-]+/g, '_')
    const path = `${channelId}/${crypto.randomUUID()}-${safe}`
    const { error } = await supabase.storage.from('chat-attachments').upload(path, file, { contentType: file.type || 'application/octet-stream' })
    if (error) throw error
    return { path, name: file.name, type: file.type, size: file.size }
  }

  async function send(channelId, body, replyTo = null, attachment = null) {
    const text = (body || '').trim()
    if (!text && !attachment) return
    await supabase.from('chat_messages').insert({ channel_id: channelId, sender_id: uid, body: text, reply_to: replyTo, attachment })
    await supabase.from('chat_members').update({ last_read_at: new Date().toISOString() }).eq('channel_id', channelId).eq('user_id', uid)
    load()
  }

  async function markRead(channelId) {
    await supabase.from('chat_members').update({ last_read_at: new Date().toISOString() }).eq('channel_id', channelId).eq('user_id', uid)
    load()
  }

  // Find an existing 1:1 DM with `otherId`, else create one (scoped to my client).
  async function openOrCreateDm(otherId) {
    const existing = channels.find(c => !c.isGroup && c.members.length === 2 && c.members.includes(otherId))
    if (existing) return existing.id
    const { data: chan, error } = await supabase.from('chat_channels')
      .insert({ type: 'dm', client_id: profile?.client_id ?? null, created_by: uid }).select().single()
    if (error || !chan) { window.alert(error?.message || 'Could not start chat'); return null }
    await supabase.from('chat_members').insert([{ channel_id: chan.id, user_id: uid }, { channel_id: chan.id, user_id: otherId }])
    await load()
    return chan.id
  }

  async function createGroup(name, memberIds) {
    const { data: chan, error } = await supabase.from('chat_channels')
      .insert({ type: 'group', name: name.trim(), client_id: profile?.client_id ?? null, created_by: uid }).select().single()
    if (error || !chan) { window.alert(error?.message || 'Could not create group'); return null }
    const rows = [uid, ...memberIds.filter(id => id !== uid)].map(id => ({ channel_id: chan.id, user_id: id }))
    await supabase.from('chat_members').insert(rows)
    await load()
    return chan.id
  }

  // ── Master Admin oversight (read-only) ──────────────────────────────────────────
  async function loadClients() {
    const { data } = await supabase.from('clients').select('id, name').order('name')
    return data ?? []
  }

  // All channels for a client (admin reads via RLS). DM names show both participants.
  async function loadOversight(clientId) {
    const { data: chans } = await supabase.from('chat_channels').select('*').eq('client_id', clientId).order('created_at', { ascending: false })
    const ids = (chans ?? []).map(c => c.id)
    if (!ids.length) return []
    const [{ data: allMems }, { data: msgs }] = await Promise.all([
      supabase.from('chat_members').select('channel_id, user_id').in('channel_id', ids),
      supabase.from('chat_messages').select('channel_id, sender_id, body, created_at').in('channel_id', ids).order('created_at', { ascending: false }).limit(600),
    ])
    const uids = [...new Set((allMems ?? []).map(m => m.user_id))]
    const { data: profs } = uids.length ? await supabase.from('profiles').select('id, full_name').in('id', uids) : { data: [] }
    const profMap = Object.fromEntries((profs ?? []).map(p => [p.id, p]))
    const byChan = {}
    ;(msgs ?? []).forEach(m => { (byChan[m.channel_id] ??= []).push(m) })
    return (chans ?? []).map(c => {
      const memberIds = (allMems ?? []).filter(m => m.channel_id === c.id).map(m => m.user_id)
      const isGroup = c.type === 'group'
      const name = isGroup ? (c.name || 'Group') : memberIds.map(id => profMap[id]?.full_name).filter(Boolean).join(' ↔ ')
      const list = byChan[c.id] ?? []
      return {
        id: c.id, type: c.type, isGroup, name: name || 'Direct message', initials: initials(name),
        members: memberIds, memberProfiles: memberIds.map(id => profMap[id]).filter(Boolean),
        last: list[0] ?? null, lastAt: list[0] ? new Date(list[0].created_at).getTime() : new Date(c.created_at).getTime(),
      }
    }).sort((a, b) => b.lastAt - a.lastAt)
  }

  return { channels, people, loading, totalUnread, reload: load, loadMessages, send, uploadAttachment, markRead, openOrCreateDm, createGroup, loadClients, loadOversight }
}
