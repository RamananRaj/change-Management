import { useEffect, useRef, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { useChat } from '../hooks/useChat'

// CFM — Change Flow Messages. A floating launcher (bottom-right) that expands into a WhatsApp-style
// chat panel in the ChangeFlow blue. DMs + groups, live unread badge, read ticks.
const CfmMark = ({ size = 34 }) => (
  <svg width={size} height={size} viewBox="0 0 34 34" fill="none" aria-hidden="true">
    <path d="M5 8.5C5 6.6 6.6 5 8.5 5H25.5C27.4 5 29 6.6 29 8.5V20C29 21.9 27.4 23.5 25.5 23.5H14L8 28.5V23.5H8.5C6.6 23.5 5 21.9 5 20V8.5Z" fill="#fff"/>
    <text x="17" y="18.4" fontSize="8.5" fontWeight="800" fill="#1F4E79" textAnchor="middle" fontFamily="Arial">CFM</text>
    <circle cx="26" cy="8" r="3" fill="#E8913A"/>
  </svg>
)

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
  const [pos, setPos] = useState(null)   // {left, top} once dragged; else docked bottom-right
  const scrollRef = useRef(null)
  const panelRef = useRef(null)
  const drag = useRef(null)

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
    setText(''); setReplyTo(null); await chat.send(activeId, t, rt)
    chat.loadMessages(activeId).then(setMessages)
  }
  async function startDm(pid) { const id = await chat.openOrCreateDm(pid); if (id) openChannel(id) }
  async function makeGroup() {
    if (!groupName.trim() || picked.length === 0) return
    const id = await chat.createGroup(groupName, picked)
    if (id) { setGroupName(''); setPicked([]); openChannel(id) }
  }
  const togglePick = pid => setPicked(p => p.includes(pid) ? p.filter(x => x !== pid) : [...p, pid])
  const senderName = sid => active?.memberProfiles.find(p => p.id === sid)?.full_name ?? 'Someone'

  const dms = chat.channels.filter(c => !c.isGroup)
  const groups = chat.channels.filter(c => c.isGroup)

  if (!user) return null

  // ── Collapsed launcher ──
  if (!open) {
    return (
      <button onClick={() => setOpen(true)} title="Change Flow Messages"
        className="fixed bottom-24 right-6 z-40 w-[62px] h-[62px] rounded-[20px] flex items-center justify-center shadow-xl"
        style={{ background: 'linear-gradient(150deg,#255a8a,#163a5c)' }}>
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
        {view === 'thread' || view === 'new' || view === 'newgroup' ? (
          <button onClick={() => setView('list')} className="text-white/90 text-lg leading-none">‹</button>
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
            : <><p className="text-[15px] font-semibold leading-tight">CFM</p><p className="text-[11px] text-white/65">Change Flow Messages</p></>}
        </div>
        {view === 'list' && (
          <>
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
          <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-3 space-y-1.5" style={{ background: '#e9eef3' }}>
            {messages.map((m, i) => {
              const mine = m.sender_id === user.id
              const showName = active.isGroup && !mine && messages[i - 1]?.sender_id !== m.sender_id
              const quoted = m.reply_to ? msgById[m.reply_to] : null
              return (
                <div key={m.id} className={`group relative max-w-[78%] px-2.5 py-1.5 rounded-lg text-[13.5px] leading-snug shadow-sm ${mine ? 'ml-auto bg-[#d3e8fb] rounded-tr-sm' : 'mr-auto bg-white rounded-tl-sm'}`}>
                  {showName && <p className="text-[11px] font-bold text-[#E8913A] mb-0.5">{senderName(m.sender_id)}</p>}
                  {quoted && (
                    <div className="border-l-2 border-[#1F4E79]/50 bg-black/[.045] rounded px-2 py-1 mb-1">
                      <p className="text-[10.5px] font-bold text-[#1F4E79] leading-tight">{senderName(quoted.sender_id)}</p>
                      <p className="text-[11px] text-slate-500 truncate">{quoted.body}</p>
                    </div>
                  )}
                  <span>{m.body}</span>
                  <span className="text-[9.5px] text-slate-400 float-right ml-2 mt-1.5">{fmtTime(m.created_at)}{mine && <span className="text-[#2f8fe0] ml-0.5">✓✓</span>}</span>
                  <button onClick={() => setReplyTo(m)} title="Reply"
                    className={`absolute top-1 opacity-0 group-hover:opacity-100 transition-opacity w-6 h-6 rounded-full bg-white border border-slate-200 text-slate-500 text-[11px] flex items-center justify-center shadow-sm ${mine ? '-left-7' : '-right-7'}`}>↩</button>
                </div>
              )
            })}
            {messages.length === 0 && <p className="text-center text-xs text-slate-400 mt-6">No messages yet — say hello 👋</p>}
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
            <span title="Attachments coming later" className="text-slate-300 text-lg cursor-not-allowed">📎</span>
            <input value={text} onChange={e => setText(e.target.value)} placeholder="Type a message"
              className="flex-1 bg-white rounded-full px-4 py-2 text-[13.5px] outline-none" />
            <button type="submit" className="w-10 h-10 rounded-full bg-[#1F4E79] text-white text-base shrink-0">➤</button>
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
