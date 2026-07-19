import { useEffect, useRef, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { useChat } from '../hooks/useChat'
import { ask } from '../lib/ai/router'
import { fmtSize, fileIcon } from '../lib/chat/helpers'

// Turn a router descriptor into a concise chat-friendly answer for CORA.
function descriptorToText(d) {
  if (!d) return "I couldn't find an answer for that."
  const strip = s => String(s ?? '').replace(/\*\*/g, '')
  if (d.type === 'narrative') return strip(d.body)
  if (d.type === 'insight') return [strip(d.lead), ...(d.areas ?? []).slice(0, 3).map(a => `${a.rank}. ${a.name}: ${strip(a.body)}`), d.move ? `The one move: ${strip(d.move)}` : ''].filter(Boolean).join('\n\n')
  if (d.type === 'heatmap') return [strip(d.headline), ...(d.insights ?? []).slice(0, 3).map(s => `• ${strip(s)}`)].filter(Boolean).join('\n')
  if (d.type === 'progress' || d.type === 'list') {
    const rows = (d.rows ?? []).slice(0, 6).map(r => r.value != null ? `• ${r.label}: ${r.value}%` : `• ${r.name ?? r.label}${r.meta ? ` — ${r.meta}` : ''}${r.due ? ` (${r.due})` : ''}`)
    return [strip(d.commentary || d.title || ''), ...rows].filter(Boolean).join('\n') || (d.empty ?? 'Nothing to show.')
  }
  if (d.type === 'report') return `Here's the ${d.title}. Open the AI canvas for the full report — I can summarise any section here if you ask.`
  if (d.body) return strip(d.body)
  return 'I can answer that in the AI canvas — ask me something more specific here and I\'ll try.'
}

// CFM — Change Flow Messages. A floating launcher (bottom-right) that expands into a WhatsApp-style
// chat panel in the ChangeFlow blue. DMs + groups, live unread badge, read ticks.
const CfmMark = ({ size = 34 }) => (
  <svg width={size} height={size} viewBox="0 0 34 34" fill="none" aria-hidden="true">
    <path d="M5 8.5C5 6.6 6.6 5 8.5 5H25.5C27.4 5 29 6.6 29 8.5V20C29 21.9 27.4 23.5 25.5 23.5H14L8 28.5V23.5H8.5C6.6 23.5 5 21.9 5 20V8.5Z" fill="#fff"/>
    <text x="17" y="18.4" fontSize="8.5" fontWeight="800" fill="#1F4E79" textAnchor="middle" fontFamily="Arial">CFM</text>
    <circle cx="26" cy="8" r="3" fill="#E8913A"/>
  </svg>
)

function Attachment({ a }) {
  if (!a) return null
  const isImg = (a.type || '').startsWith('image/')
  if (isImg) return (
    <a href={a.url || '#'} target="_blank" rel="noreferrer" className="block my-1">
      {a.url ? <img src={a.url} alt={a.name} className="rounded-lg max-h-52 border border-black/5" /> : <div className="h-24 w-40 bg-black/5 rounded-lg animate-pulse" />}
    </a>
  )
  return (
    <a href={a.url || '#'} target="_blank" rel="noreferrer" className="flex items-center gap-2 my-1 bg-black/[.06] hover:bg-black/[.09] rounded-lg px-2.5 py-2 max-w-[240px]">
      <span className="text-xl shrink-0">{fileIcon(a.type)}</span>
      <span className="min-w-0"><span className="block text-[12.5px] font-semibold text-slate-700 truncate">{a.name}</span><span className="text-[10.5px] text-slate-400">{fmtSize(a.size)}</span></span>
    </a>
  )
}

const fmtTime = d => new Date(d).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
const fmtWhen = d => {
  const dt = new Date(d), now = new Date()
  if (dt.toDateString() === now.toDateString()) return fmtTime(d)
  const days = Math.round((now - dt) / 86400000)
  if (days < 7) return dt.toLocaleDateString([], { weekday: 'short' })
  return dt.toLocaleDateString([], { day: 'numeric', month: 'short' })
}

export default function CFM() {
  const { user, profile } = useAuth()
  const chat = useChat(user, profile)
  const [open, setOpen] = useState(false)
  const [activeId, setActiveId] = useState(null)
  const [messages, setMessages] = useState([])
  const [text, setText] = useState('')
  const [view, setView] = useState('list')   // 'list' | 'thread' | 'new' | 'newgroup'
  const [replyTo, setReplyTo] = useState(null)   // message being replied to
  const [groupName, setGroupName] = useState('')
  const [picked, setPicked] = useState([])
  // Master Admin oversight (read-only)
  const [ovClients, setOvClients] = useState([])
  const [ovClient, setOvClient] = useState(null)
  const [ovChannels, setOvChannels] = useState([])
  const [ovActive, setOvActive] = useState(null)
  const [ovMessages, setOvMessages] = useState([])
  const [pos, setPos] = useState(null)   // {left, top} once dragged; else docked bottom-right
  const scrollRef = useRef(null)
  const panelRef = useRef(null)
  const drag = useRef(null)
  const fileRef = useRef(null)
  const msgInputRef = useRef(null)
  const [uploading, setUploading] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const [aiThinking, setAiThinking] = useState(false)

  function hdrDown(e) {
    if (e.target.closest('button')) return   // let header buttons work
    const r = panelRef.current.getBoundingClientRect()
    drag.current = { dx: e.clientX - r.left, dy: e.clientY - r.top }
    e.currentTarget.setPointerCapture(e.pointerId)
  }
  function hdrMove(e) {
    if (!drag.current) return
    const w = panelRef.current.offsetWidth, h = panelRef.current.offsetHeight
    const left = Math.max(6, Math.min(e.clientX - drag.current.dx, window.innerWidth - w - 6))
    const top  = Math.max(6, Math.min(e.clientY - drag.current.dy, window.innerHeight - h - 6))
    setPos({ left, top })
  }
  function hdrUp(e) { drag.current = null; try { e.currentTarget.releasePointerCapture(e.pointerId) } catch { /* noop */ } }

  // Draggable launcher icon — distinguishes a drag from a click (a plain click opens the panel).
  const [launcherPos, setLauncherPos] = useState(null)
  const ldrag = useRef(null)
  function lDown(e) {
    const r = e.currentTarget.getBoundingClientRect()
    ldrag.current = { dx: e.clientX - r.left, dy: e.clientY - r.top, sx: e.clientX, sy: e.clientY, moved: false }
    e.currentTarget.setPointerCapture(e.pointerId)
  }
  function lMove(e) {
    const d = ldrag.current; if (!d) return
    if (Math.abs(e.clientX - d.sx) + Math.abs(e.clientY - d.sy) > 4) d.moved = true
    if (!d.moved) return
    const left = Math.max(6, Math.min(e.clientX - d.dx, window.innerWidth - 62 - 6))
    const top  = Math.max(6, Math.min(e.clientY - d.dy, window.innerHeight - 62 - 6))
    setLauncherPos({ left, top })
  }
  function lUp(e) {
    const d = ldrag.current; ldrag.current = null
    try { e.currentTarget.releasePointerCapture(e.pointerId) } catch { /* noop */ }
    if (d && !d.moved) setOpen(true)   // it was a tap, not a drag → open
  }

  const active = chat.channels.find(c => c.id === activeId) || null

  // Load the thread when a channel is opened, and refresh it whenever the channel list updates
  // (realtime). Mark it read on open.
  useEffect(() => {
    if (!activeId) return
    let live = true
    chat.loadMessages(activeId).then(m => { if (live) setMessages(m) })
    return () => { live = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId, chat.channels])

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight
  }, [messages, view])

  function openChannel(id) {
    setActiveId(id); setView('thread'); setReplyTo(null); chat.markRead(id)
  }
  const msgById = Object.fromEntries(messages.map(m => [m.id, m]))
  async function submit(e) {
    e?.preventDefault()
    const t = text.trim(); if (!t || !activeId) return
    const rt = replyTo?.id ?? null
    setText(''); setReplyTo(null)
    await chat.send(activeId, t, rt)
    // CORA: if the message calls @cora, answer it inline (grounded, role-scoped).
    const m = t.match(/@cora\b[:,]?\s*(.*)/is)
    if (m) {
      const q = (m[1] || '').trim() || t.replace(/@cora/ig, '').trim()
      setAiThinking(true)
      try {
        const d = await ask(q, { userId: user.id, clientId: profile?.client_id ?? null })
        await chat.send(activeId, descriptorToText(d), null, null, true)
      } catch {
        await chat.send(activeId, "I couldn't work that out just now — try rephrasing.", null, null, true)
      } finally { setAiThinking(false) }
    }
    chat.loadMessages(activeId).then(setMessages)
  }
  async function sendFile(file) {
    if (!file || !activeId) return
    if (file.size > 25 * 1024 * 1024) { window.alert('Files must be under 25 MB.'); return }
    setUploading(true)
    try {
      const att = await chat.uploadAttachment(activeId, file)
      await chat.send(activeId, text.trim(), replyTo?.id ?? null, att)
      setText(''); setReplyTo(null)
      chat.loadMessages(activeId).then(setMessages)
    } catch (err) {
      window.alert('Upload failed: ' + (err?.message || err))
    } finally { setUploading(false) }
  }
  async function startDm(pid) { const id = await chat.openOrCreateDm(pid); if (id) openChannel(id) }
  async function makeGroup() {
    if (!groupName.trim() || picked.length === 0) return
    const id = await chat.createGroup(groupName, picked)
    if (id) { setGroupName(''); setPicked([]); openChannel(id) }
  }
  const togglePick = pid => setPicked(p => p.includes(pid) ? p.filter(x => x !== pid) : [...p, pid])
  const senderName = sid => active?.memberProfiles.find(p => p.id === sid)?.full_name ?? 'Someone'
  const ovSenderName = sid => ovActive?.memberProfiles.find(p => p.id === sid)?.full_name ?? 'Someone'

  async function openOversight() { setView('oversight'); setOvClient(null); setOvActive(null); setOvClients(await chat.loadClients()) }
  async function pickOvClient(c) { setOvClient(c); setOvActive(null); setOvChannels(await chat.loadOversight(c.id)) }
  async function openOvChannel(c) { setOvActive(c); setOvMessages(await chat.loadMessages(c.id)) }
  function ovBack() { if (ovActive) setOvActive(null); else if (ovClient) setOvClient(null); else setView('list') }

  const dms = chat.channels.filter(c => !c.isGroup)
  const groups = chat.channels.filter(c => c.isGroup)

  if (!user) return null

  // ── Collapsed launcher ──
  if (!open) {
    return (
      <button onPointerDown={lDown} onPointerMove={lMove} onPointerUp={lUp} title="Change Flow Messages — drag to move"
        className={`fixed z-40 w-[62px] h-[62px] rounded-[20px] flex items-center justify-center shadow-xl cursor-grab active:cursor-grabbing ${launcherPos ? '' : 'bottom-24 right-6'}`}
        style={{ background: 'linear-gradient(150deg,#255a8a,#163a5c)', touchAction: 'none', ...(launcherPos ? { left: launcherPos.left, top: launcherPos.top } : {}) }}>
        <CfmMark />
        {chat.totalUnread > 0 && (
          <span className="absolute -top-1.5 -right-1.5 min-w-[24px] h-6 px-1.5 bg-[#E8913A] text-white text-[12.5px] font-extrabold rounded-full flex items-center justify-center border-[2.5px] border-slate-50">
            {chat.totalUnread > 99 ? '99+' : chat.totalUnread}
          </span>
        )}
      </button>
    )
  }

  const Avatar = ({ name, group, online }) => (
    <div className={`w-10 h-10 rounded-full text-white font-bold text-[13px] flex items-center justify-center shrink-0 relative ${group ? 'bg-[#E8913A]' : 'bg-[#1F4E79]'}`}>
      {(name || '?').split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2)}
    </div>
  )

  return (
    <div ref={panelRef} className={`fixed z-40 w-[380px] h-[560px] rounded-[18px] overflow-hidden bg-white flex flex-col ${pos ? '' : 'bottom-24 right-6'}`}
      style={{ boxShadow: '0 18px 50px rgba(15,40,70,.28)', ...(pos ? { left: pos.left, top: pos.top } : {}) }}>
      {/* Header (drag handle) */}
      <div onPointerDown={hdrDown} onPointerMove={hdrMove} onPointerUp={hdrUp}
        className="bg-[#1F4E79] text-white px-4 py-3 flex items-center gap-3 cursor-move select-none" style={{ touchAction: 'none' }}>
        {view !== 'list' ? (
          <button onClick={() => (view === 'oversight' ? ovBack() : setView('list'))} className="text-white/90 text-lg leading-none">‹</button>
        ) : (
          <div className="w-8 h-8 rounded-lg bg-white/15 flex items-center justify-center"><CfmMark size={20} /></div>
        )}
        <div className="flex-1 min-w-0">
          {view === 'thread' && active ? (
            <>
              <p className="text-[15px] font-semibold leading-tight truncate">{active.name}</p>
              <p className="text-[11px] text-white/65">{active.isGroup ? `${active.members.length} members` : 'Direct message'}</p>
            </>
          ) : view === 'new' ? <p className="text-[15px] font-semibold">New chat</p>
            : view === 'newgroup' ? <p className="text-[15px] font-semibold">New group</p>
            : view === 'oversight' ? (
              <><p className="text-[15px] font-semibold leading-tight truncate">{ovActive?.name || ovClient?.name || 'Oversight'}</p>
                <p className="text-[11px] text-white/65">{ovActive ? 'Read-only' : ovClient ? 'Conversations' : 'Pick a client'}</p></>
            ) : <><p className="text-[15px] font-semibold leading-tight">CFM</p><p className="text-[11px] text-white/65">Change Flow Messages</p></>}
        </div>
        {view === 'list' && (
          <>
            {profile?.is_admin && <button onClick={openOversight} title="Oversight (read-only)" className="text-white/90 text-base">🔎</button>}
            <button onClick={() => setView('newgroup')} title="New group" className="text-white/90 text-base">👥</button>
            <button onClick={() => setView('new')} title="New chat" className="text-white/90 text-base">✎</button>
          </>
        )}
        <button onClick={() => setOpen(false)} title="Collapse" className="text-white/90 text-lg leading-none">⌄</button>
      </div>

      {/* Body */}
      {view === 'list' && (
        <div className="flex-1 overflow-y-auto">
          {profile?.is_admin && (
            <p className="text-[10.5px] text-indigo-700 bg-indigo-50 px-4 py-1.5">Master Admin — you can read all chats; you post only where you're a member.</p>
          )}
          {chat.loading ? (
            <p className="text-sm text-slate-400 p-4">Loading…</p>
          ) : chat.channels.length === 0 ? (
            <div className="text-center py-12 px-6">
              <p className="text-slate-400 text-sm">No conversations yet.</p>
              <button onClick={() => setView('new')} className="text-[#1F4E79] text-sm font-semibold hover:underline mt-2">Start a chat →</button>
            </div>
          ) : (
            <>
              {dms.length > 0 && <p className="text-[9.5px] font-bold text-slate-400 uppercase tracking-widest px-4 pt-3 pb-1">Direct messages</p>}
              {dms.map(c => <ConvRow key={c.id} c={c} onClick={() => openChannel(c.id)} />)}
              {groups.length > 0 && <p className="text-[9.5px] font-bold text-slate-400 uppercase tracking-widest px-4 pt-3 pb-1">Groups</p>}
              {groups.map(c => <ConvRow key={c.id} c={c} onClick={() => openChannel(c.id)} />)}
            </>
          )}
        </div>
      )}

      {view === 'thread' && active && (
        <>
          <div ref={scrollRef} onDragOver={e => { e.preventDefault(); setDragOver(true) }} onDragLeave={() => setDragOver(false)}
            onDrop={e => { e.preventDefault(); setDragOver(false); if (e.dataTransfer.files[0]) sendFile(e.dataTransfer.files[0]) }}
            className={`flex-1 overflow-y-auto px-4 py-3 space-y-1.5 ${dragOver ? 'ring-2 ring-inset ring-[#1F4E79]' : ''}`} style={{ background: '#e9eef3' }}>
            {messages.map((m, i) => {
              const isAi = m.is_ai
              const mine = !isAi && m.sender_id === user.id
              const showName = active.isGroup && !mine && !isAi && messages[i - 1]?.sender_id !== m.sender_id
              const quoted = m.reply_to ? msgById[m.reply_to] : null
              return (
                <div key={m.id} className={`group relative max-w-[80%] px-2.5 py-1.5 rounded-lg text-[13.5px] leading-snug shadow-sm ${isAi ? 'mr-auto bg-violet-50 border border-violet-100 rounded-tl-sm' : mine ? 'ml-auto bg-[#d3e8fb] rounded-tr-sm' : 'mr-auto bg-white rounded-tl-sm'}`}>
                  {isAi ? <p className="text-[11px] font-bold text-violet-700 mb-0.5">✦ CORA</p> : showName && <p className="text-[11px] font-bold text-[#E8913A] mb-0.5">{senderName(m.sender_id)}</p>}
                  {quoted && (
                    <div className="border-l-2 border-[#1F4E79]/50 bg-black/[.045] rounded px-2 py-1 mb-1">
                      <p className="text-[10.5px] font-bold text-[#1F4E79] leading-tight">{senderName(quoted.sender_id)}</p>
                      <p className="text-[11px] text-slate-500 truncate">{quoted.body}</p>
                    </div>
                  )}
                  {m.attachment && <Attachment a={m.attachment} />}
                  {m.body && <span className={isAi ? 'whitespace-pre-wrap' : ''}>{m.body}</span>}
                  <span className="text-[9.5px] text-slate-400 float-right ml-2 mt-1.5">{fmtTime(m.created_at)}{mine && <span className="text-[#2f8fe0] ml-0.5">✓✓</span>}</span>
                  {!isAi && <button onClick={() => setReplyTo(m)} title="Reply"
                    className={`absolute top-1 opacity-0 group-hover:opacity-100 transition-opacity w-6 h-6 rounded-full bg-white border border-slate-200 text-slate-500 text-[11px] flex items-center justify-center shadow-sm ${mine ? '-left-7' : '-right-7'}`}>↩</button>}
                </div>
              )
            })}
            {aiThinking && <div className="mr-auto max-w-[80%] px-3 py-2 rounded-lg bg-violet-50 border border-violet-100 text-[12.5px] text-violet-600 animate-pulse">✦ CORA is thinking…</div>}
            {messages.length === 0 && <p className="text-center text-xs text-slate-400 mt-6">No messages yet — say hello, or ask <span className="font-semibold text-violet-600">@cora</span> 👋</p>}
          </div>
          {replyTo && (
            <div className="bg-[#f0f2f5] px-3 pt-2 -mb-1">
              <div className="bg-white border-l-[3px] border-[#1F4E79] rounded px-3 py-1.5 flex items-center gap-2">
                <div className="min-w-0 flex-1">
                  <p className="text-[11px] font-bold text-[#1F4E79] leading-tight">Reply to {senderName(replyTo.sender_id)}</p>
                  <p className="text-[11px] text-slate-500 truncate">{replyTo.body}</p>
                </div>
                <button onClick={() => setReplyTo(null)} className="text-slate-400 hover:text-slate-600 text-sm shrink-0">✕</button>
              </div>
            </div>
          )}
          <form onSubmit={submit} className="bg-[#f0f2f5] px-3 py-2.5 flex items-center gap-2.5">
            <input ref={fileRef} type="file" className="hidden" accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.csv,.ppt,.pptx,.txt"
              onChange={e => { const f = e.target.files?.[0]; if (f) sendFile(f); e.target.value = '' }} />
            <button type="button" onClick={() => fileRef.current?.click()} disabled={uploading}
              title="Attach a file" className="text-slate-500 hover:text-[#1F4E79] text-lg disabled:opacity-40">📎</button>
            <button type="button" onClick={() => { setText(t => /^@cora\b/i.test(t.trim()) ? t : `@cora ${t}`.trimStart()); msgInputRef.current?.focus() }}
              title="Ask CORA" className="text-violet-500 hover:text-violet-700 text-base font-bold shrink-0">✦</button>
            <input ref={msgInputRef} value={text} onChange={e => setText(e.target.value)} placeholder={uploading ? 'Uploading…' : 'Message · ✦ to ask CORA'}
              onPaste={e => { const f = [...e.clipboardData.files][0]; if (f) { e.preventDefault(); sendFile(f) } }}
              className="flex-1 bg-white rounded-full px-4 py-2 text-[13.5px] outline-none" />
            <button type="submit" disabled={uploading} className="w-10 h-10 rounded-full bg-[#1F4E79] text-white text-base shrink-0 disabled:opacity-50">➤</button>
          </form>
        </>
      )}

      {view === 'new' && (
        <div className="flex-1 overflow-y-auto p-2">
          {chat.people.length === 0 ? <p className="text-sm text-slate-400 p-4">No one to chat with yet.</p> :
            chat.people.map(p => (
              <button key={p.id} onClick={() => startDm(p.id)} className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-slate-50 rounded-lg text-left">
                <Avatar name={p.full_name} />
                <div><p className="text-sm font-semibold text-slate-800">{p.full_name}</p>
                  <p className="text-[11px] text-slate-400">{p.is_admin ? 'Master Admin' : p.is_client_admin ? 'Client Admin' : (p.role || 'Member')}</p></div>
              </button>
            ))}
        </div>
      )}

      {view === 'newgroup' && (
        <div className="flex-1 overflow-y-auto p-3">
          <input value={groupName} onChange={e => setGroupName(e.target.value)} placeholder="Group name"
            className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm mb-3 focus:outline-none focus:border-[#1F4E79]" />
          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1.5">Add people ({picked.length})</p>
          <div className="space-y-1">
            {chat.people.map(p => (
              <label key={p.id} className="flex items-center gap-3 px-2 py-2 hover:bg-slate-50 rounded-lg cursor-pointer">
                <input type="checkbox" checked={picked.includes(p.id)} onChange={() => togglePick(p.id)} className="w-4 h-4 accent-[#1F4E79]" />
                <Avatar name={p.full_name} />
                <span className="text-sm text-slate-700">{p.full_name}</span>
              </label>
            ))}
          </div>
          <button onClick={makeGroup} disabled={!groupName.trim() || picked.length === 0}
            className="mt-4 w-full bg-[#1F4E79] text-white text-sm font-semibold py-2.5 rounded-lg disabled:opacity-50">
            Create group
          </button>
        </div>
      )}

      {view === 'oversight' && (
        <div className="flex-1 overflow-y-auto flex flex-col">
          {!ovClient ? (
            /* 1 — pick a client */
            <div className="p-2">
              <p className="text-[10.5px] text-indigo-700 bg-indigo-50 px-3 py-1.5 rounded-lg mb-1">Read-only oversight — pick a client to view their conversations.</p>
              {ovClients.length === 0 ? <p className="text-sm text-slate-400 p-4">No clients.</p> :
                ovClients.map(c => (
                  <button key={c.id} onClick={() => pickOvClient(c)} className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-slate-50 rounded-lg text-left">
                    <div className="w-10 h-10 rounded-full bg-[#1F4E79] text-white font-bold text-[13px] flex items-center justify-center shrink-0">{c.name.charAt(0).toUpperCase()}</div>
                    <span className="text-sm font-semibold text-slate-800">{c.name}</span>
                    <span className="ml-auto text-slate-300">›</span>
                  </button>
                ))}
            </div>
          ) : !ovActive ? (
            /* 2 — that client's conversations */
            ovChannels.length === 0 ? (
              <p className="text-sm text-slate-400 p-6 text-center">{ovClient.name} has no conversations yet.</p>
            ) : (
              <div>
                {ovChannels.filter(c => !c.isGroup).length > 0 && <p className="text-[9.5px] font-bold text-slate-400 uppercase tracking-widest px-4 pt-3 pb-1">Direct messages</p>}
                {ovChannels.filter(c => !c.isGroup).map(c => <ConvRow key={c.id} c={c} onClick={() => openOvChannel(c)} />)}
                {ovChannels.filter(c => c.isGroup).length > 0 && <p className="text-[9.5px] font-bold text-slate-400 uppercase tracking-widest px-4 pt-3 pb-1">Groups</p>}
                {ovChannels.filter(c => c.isGroup).map(c => <ConvRow key={c.id} c={c} onClick={() => openOvChannel(c)} />)}
              </div>
            )
          ) : (
            /* 3 — read-only thread */
            <>
              <div className="flex-1 overflow-y-auto px-4 py-3 space-y-1.5" style={{ background: '#e9eef3' }}>
                {ovMessages.map((m, i) => {
                  const showName = ovMessages[i - 1]?.sender_id !== m.sender_id || ovMessages[i - 1]?.is_ai !== m.is_ai
                  const quoted = m.reply_to ? ovMessages.find(x => x.id === m.reply_to) : null
                  return (
                    <div key={m.id} className={`max-w-[80%] mr-auto rounded-lg rounded-tl-sm px-2.5 py-1.5 text-[13.5px] leading-snug shadow-sm ${m.is_ai ? 'bg-violet-50 border border-violet-100' : 'bg-white'}`}>
                      {showName && <p className={`text-[11px] font-bold mb-0.5 ${m.is_ai ? 'text-violet-700' : 'text-[#E8913A]'}`}>{m.is_ai ? '✦ CORA' : ovSenderName(m.sender_id)}</p>}
                      {quoted && <div className="border-l-2 border-[#1F4E79]/50 bg-black/[.045] rounded px-2 py-1 mb-1"><p className="text-[10.5px] font-bold text-[#1F4E79]">{ovSenderName(quoted.sender_id)}</p><p className="text-[11px] text-slate-500 truncate">{quoted.body}</p></div>}
                      {m.attachment && <Attachment a={m.attachment} />}
                      {m.body && <span>{m.body}</span>}
                      <span className="text-[9.5px] text-slate-400 float-right ml-2 mt-1.5">{fmtTime(m.created_at)}</span>
                    </div>
                  )
                })}
                {ovMessages.length === 0 && <p className="text-center text-xs text-slate-400 mt-6">No messages.</p>}
              </div>
              <div className="bg-[#f0f2f5] px-4 py-3 text-center text-[11px] text-slate-400 italic">Read-only oversight — you're not a participant in this chat.</div>
            </>
          )}
        </div>
      )}
    </div>
  )
}

function ConvRow({ c, onClick }) {
  const last = c.last
  return (
    <button onClick={onClick} className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-slate-50 border-b border-slate-50 text-left">
      <div className={`w-11 h-11 rounded-full text-white font-bold text-[13px] flex items-center justify-center shrink-0 ${c.isGroup ? 'bg-[#E8913A]' : 'bg-[#1F4E79]'}`}>{c.initials}</div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-[14px] font-semibold text-slate-800 truncate flex-1">{c.name}</span>
          {last && <span className={`text-[10.5px] shrink-0 ${c.unread ? 'text-[#1F4E79] font-bold' : 'text-slate-400'}`}>{fmtWhen(last.created_at)}</span>}
        </div>
        <div className="flex items-center gap-2 mt-0.5">
          <span className="text-[12px] text-slate-500 truncate flex-1">{last?.body ?? 'No messages yet'}</span>
          {c.unread > 0 && <span className="bg-[#1F4E79] text-white text-[10.5px] font-bold rounded-full min-w-[18px] h-[18px] px-1.5 flex items-center justify-center shrink-0">{c.unread}</span>}
        </div>
      </div>
    </button>
  )
}
