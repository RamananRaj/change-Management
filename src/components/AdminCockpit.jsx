import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

// Admin Cockpit — 360° health across every client account, in the AI theme.
// Each client is a card with status dimensions (Onboarding / Activity / People / Progress /
// Timeline). Grounded in the same data the AI rules use. Scoped by RLS: a Client Admin sees
// only their own client. Click a card → the Clients module. Bottom: the admin "Ask" pill.
export default function AdminCockpit({ onOpenClient }) {
  const [rows, setRows] = useState(null)

  useEffect(() => { load() }, [])

  async function load() {
    const today = new Date()
    const [{ data: cls }, { data: projects }] = await Promise.all([
      supabase.from('clients').select('id, name, industry').order('name'),
      supabase.from('projects').select('id, name, client_id'),
    ])
    const projIds = (projects ?? []).map(p => p.id)

    let members = [], pathways = [], phaseRows = [], acts = [], profiles = []
    if (projIds.length) {
      const [{ data: m }, { data: pw }, { data: ph }] = await Promise.all([
        supabase.from('project_members').select('project_id, user_id').in('project_id', projIds),
        supabase.from('project_pathways').select('project_id, content_id').in('project_id', projIds),
        supabase.from('project_phases').select('project_id, planned_end, status').in('project_id', projIds),
      ])
      members = m ?? []; pathways = pw ?? []; phaseRows = ph ?? []
      const ids = [...new Set(members.map(x => x.user_id))]
      if (ids.length) {
        const [{ data: a }, { data: pr }] = await Promise.all([
          supabase.from('user_activities').select('user_id, content_id, status').in('user_id', ids).eq('status', 'completed'),
          supabase.from('profiles').select('id, onboarding_done').in('id', ids),
        ])
        acts = a ?? []; profiles = pr ?? []
      }
    }

    const out = (cls ?? []).map(c => {
      const cp = (projects ?? []).filter(p => p.client_id === c.id)
      const cpIds = cp.map(p => p.id)
      const memberIds = [...new Set(members.filter(m => cpIds.includes(m.project_id)).map(m => m.user_id))]

      const onboarded = memberIds.filter(id => profiles.find(p => p.id === id)?.onboarding_done).length
      const onbState = memberIds.length === 0 ? 'r' : onboarded === memberIds.length ? 'g' : onboarded > 0 ? 'a' : 'r'

      const memberActs = acts.filter(a => memberIds.includes(a.user_id))
      const actState = memberIds.length === 0 ? 'r' : memberActs.length > 0 ? 'g' : 'a'

      const peopleState = memberIds.length > 1 ? 'g' : memberIds.length === 1 ? 'a' : 'r'

      const cIds = new Set(pathways.filter(pw => cpIds.includes(pw.project_id)).map(pw => pw.content_id))
      const total = cIds.size * Math.max(memberIds.length, 1)
      const done = acts.filter(a => memberIds.includes(a.user_id) && cIds.has(a.content_id)).length
      const pct = total > 0 ? Math.round((done / total) * 100) : 0
      const progState = cIds.size === 0 ? 'a' : pct >= 66 ? 'g' : pct >= 33 ? 'a' : 'r'

      const overdue = phaseRows.filter(r => cpIds.includes(r.project_id) && r.planned_end && new Date(r.planned_end) < today && r.status !== 'completed').length
      const tlState = cp.length === 0 ? 'r' : overdue === 0 ? 'g' : overdue <= 2 ? 'a' : 'r'

      const dims = [['Onboarding', onbState], ['Activity', actState], ['People', peopleState], ['Progress', progState], ['Timeline', tlState]]
      const reds = dims.filter(([, s]) => s === 'r').length
      const rag = reds >= 3 || (cp.length === 0) ? 'risk' : dims.some(([, s]) => s !== 'g') ? 'att' : 'ok'

      return { id: c.id, name: c.name, projects: cp.length, members: memberIds.length, pct, dims, rag }
    })
    setRows(out)
  }

  const RAG = { ok: { c: '#16A34A', label: 'Healthy', badge: 'bg-green-100 text-green-700' },
    att: { c: '#D97706', label: 'Attention', badge: 'bg-amber-100 text-amber-700' },
    risk: { c: '#DC2626', label: 'At risk', badge: 'bg-red-100 text-red-700' } }
  const dimClass = s => s === 'g' ? 'bg-green-50 border-green-200 text-green-700' : s === 'a' ? 'bg-amber-50 border-amber-200 text-amber-700' : 'bg-red-50 border-red-200 text-red-700'
  const dimDot = s => s === 'g' ? '#16A34A' : s === 'a' ? '#D97706' : '#DC2626'

  const counts = { ok: 0, att: 0, risk: 0 }
  ;(rows ?? []).forEach(r => counts[r.rag]++)

  return (
    <div>
      <div className="flex items-center gap-3 mb-4 flex-wrap">
        <p className="text-slate-500 text-sm">360° health across every client account. Click a card for the full view.</p>
        <div className="ml-auto flex gap-4 text-[13px] font-semibold">
          <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-green-500" />{counts.ok} Healthy</span>
          <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-amber-500" />{counts.att} Attention</span>
          <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-red-500" />{counts.risk} At risk</span>
        </div>
      </div>

      {rows === null ? (
        <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))' }}>
          {[1, 2].map(n => <div key={n} className="h-44 bg-slate-100 rounded-2xl animate-pulse" />)}
        </div>
      ) : rows.length === 0 ? (
        <div className="text-center py-16 bg-slate-50 rounded-2xl border border-slate-200 text-slate-400 text-sm">No clients yet.</div>
      ) : (
        <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))' }}>
          {rows.map(r => {
            const rag = RAG[r.rag]
            return (
              <div key={r.id} onClick={() => onOpenClient?.(r.id)}
                className="bg-white border border-slate-200 rounded-2xl p-5 cursor-pointer transition-all hover:-translate-y-0.5 hover:shadow-lg shadow-sm"
                style={{ borderLeft: `4px solid ${rag.c}` }}>
                <div className="flex items-center gap-2 mb-1">
                  <span className="w-2.5 h-2.5 rounded-full" style={{ background: rag.c }} />
                  <b className="text-[15px] font-extrabold text-slate-800">{r.name}</b>
                  <span className={`ml-auto text-[10.5px] font-bold px-2.5 py-0.5 rounded-full ${rag.badge}`}>{rag.label}</span>
                </div>
                <p className="text-xs text-slate-400 mb-3">{r.projects} project{r.projects === 1 ? '' : 's'} · {r.members} member{r.members === 1 ? '' : 's'}</p>
                <div className="flex flex-wrap gap-1.5 mb-4">
                  {r.dims.map(([label, s]) => (
                    <span key={label} className={`flex items-center gap-1.5 text-[12px] font-semibold px-2.5 py-1 rounded-full border ${dimClass(s)}`}>
                      <span className="w-1.5 h-1.5 rounded-full" style={{ background: dimDot(s) }} />{label}
                    </span>
                  ))}
                </div>
                <div className="flex items-center text-xs text-slate-400 border-t border-slate-100 pt-3">
                  <span>{r.projects} project{r.projects === 1 ? '' : 's'}</span>
                  <span className="mx-3">·</span>
                  <span>{r.members} member{r.members === 1 ? '' : 's'}</span>
                  <span className="ml-auto font-semibold text-[#1F4E79]">{r.pct}% complete</span>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
