import { useEffect, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../lib/supabase'
import AiCanvas from './AiCanvas'

const PHASES = [1, 2, 3, 4, 5]

function ragLabel(score) {
  if (score === null || score === undefined) return '—'
  if (score >= 3.5) return 'On track'
  if (score >= 2.5) return 'At risk'
  return 'Critical'
}

// Client Admin landing: an AI canvas scoped to their client. KPI chips summarise their programme
// (readiness / projects / people / avg completion / need-attention) and seed the canvas.
export default function ClientAdminDashboard() {
  const { profile } = useAuth()
  const [client, setClient] = useState(null)
  const [totals, setTotals] = useState({ projects: 0, members: 0, pct: 0, atRisk: 0, rag: '—' })

  const firstName = profile?.full_name ? profile.full_name.split(' ')[0] : 'there'
  const hour = new Date().getHours()
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening'

  useEffect(() => { if (profile?.client_id) load() }, [profile?.client_id])

  async function load() {
    const today = new Date()
    const clientId = profile.client_id
    const { data: cl } = await supabase.from('clients').select('id, name').eq('id', clientId).single()
    setClient(cl)

    const { data: projects } = await supabase.from('projects').select('id').eq('client_id', clientId)
    const projIds = (projects ?? []).map(p => p.id)
    if (projIds.length === 0) { setTotals({ projects: 0, members: 0, pct: 0, atRisk: 0, rag: '—' }); return }

    const [{ data: members }, { data: pathways }, { data: phaseRows }] = await Promise.all([
      supabase.from('project_members').select('project_id, user_id').in('project_id', projIds),
      supabase.from('project_pathways').select('project_id, phase_number, content_id').in('project_id', projIds),
      supabase.from('project_phases').select('project_id, phase_number, planned_end').in('project_id', projIds),
    ])
    const memberIds = [...new Set((members ?? []).map(m => m.user_id))]
    let acts = [], surveys = []
    if (memberIds.length) {
      const [{ data: a }, { data: s }] = await Promise.all([
        supabase.from('user_activities').select('user_id, content_id, status').in('user_id', memberIds).eq('status', 'completed'),
        supabase.from('survey_responses').select('user_id, score, submitted_at').in('user_id', memberIds).not('submitted_at', 'is', null),
      ])
      acts = a ?? []; surveys = s ?? []
    }

    let gDone = 0, gTotal = 0, atRisk = 0
    ;(projects ?? []).forEach(p => {
      const pMembers = [...new Set((members ?? []).filter(m => m.project_id === p.id).map(m => m.user_id))]
      PHASES.forEach(n => {
        const cIds = new Set((pathways ?? []).filter(pw => pw.project_id === p.id && pw.phase_number === n).map(pw => pw.content_id))
        const steps = cIds.size
        const total = steps * Math.max(pMembers.length, 1)
        const done  = acts.filter(a => pMembers.includes(a.user_id) && cIds.has(a.content_id)).length
        gDone += done; gTotal += total
        const row = (phaseRows ?? []).find(r => r.project_id === p.id && r.phase_number === n)
        const pct = total > 0 ? Math.round((done / total) * 100) : 0
        if (row?.planned_end && new Date(row.planned_end) < today && pct < 100 && steps > 0) atRisk++
      })
    })
    const scored = surveys.filter(s => s.score !== null)
    const avg = scored.length ? scored.reduce((s, r) => s + r.score, 0) / scored.length : null

    setTotals({
      projects: projIds.length, members: memberIds.length,
      pct: gTotal > 0 ? Math.round((gDone / gTotal) * 100) : 0, atRisk, rag: ragLabel(avg),
    })
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="bg-[#1F4E79] text-white px-8 py-8">
        <p className="text-xs font-semibold tracking-widest text-white/50 uppercase mb-1">Client Admin</p>
        <h1 className="text-2xl font-bold">{greeting}, {firstName}</h1>
        <p className="text-white/70 text-sm mt-1">Ask AI about <strong>{client?.name ?? 'your programme'}</strong> — grounded in your data</p>
      </div>

      <div className="px-8 py-6">
        <AiCanvas
          context={`Programme overview for ${client?.name ?? 'your client'}`}
          chips={[
            { color: '#1F4E79', tag: 'RAG',      label: 'Readiness',      value: totals.rag,      query: 'Summarise readiness' },
            { color: '#1F4E79', tag: 'PROJECTS', label: 'Projects',       value: totals.projects, query: 'Progress by project' },
            { color: '#1F4E79', tag: 'PEOPLE',   label: 'People',         value: totals.members,  query: 'Show all people' },
            { color: '#E8913A', tag: 'PROGRESS', label: 'Avg completion', value: `${totals.pct}%`, query: 'Progress by project' },
            { color: totals.atRisk > 0 ? '#DC2626' : '#16A34A', tag: 'ATTENTION', label: 'Need attention', value: totals.atRisk, query: "What's at risk this week?" },
          ]}
        />
      </div>
    </div>
  )
}
