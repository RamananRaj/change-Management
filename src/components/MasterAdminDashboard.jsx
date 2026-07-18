import { useEffect, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../lib/supabase'
import AiCanvas from './AiCanvas'

const PHASES = [1, 2, 3, 4, 5]

// Platform-admin landing: an AI canvas across all clients. The KPI chips (clients / projects /
// people / avg completion / need-attention) summarise the platform and seed the canvas queries.
export default function MasterAdminDashboard() {
  const { profile } = useAuth()
  const [totals, setTotals] = useState({ clients: 0, projects: 0, members: 0, pct: 0, atRisk: 0 })

  const firstName = profile?.full_name ? profile.full_name.split(' ')[0] : 'there'
  const hour = new Date().getHours()
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening'

  useEffect(() => { load() }, [])

  async function load() {
    const today = new Date()
    const [{ data: clients }, { data: projects }] = await Promise.all([
      supabase.from('clients').select('id').order('name'),
      supabase.from('projects').select('id'),
    ])
    const projIds = (projects ?? []).map(p => p.id)

    let members = [], pathways = [], phaseRows = [], acts = []
    if (projIds.length) {
      const [{ data: m }, { data: pw }, { data: ph }] = await Promise.all([
        supabase.from('project_members').select('project_id, user_id').in('project_id', projIds),
        supabase.from('project_pathways').select('project_id, phase_number, content_id').in('project_id', projIds),
        supabase.from('project_phases').select('project_id, phase_number, planned_end').in('project_id', projIds),
      ])
      members = m ?? []; pathways = pw ?? []; phaseRows = ph ?? []
      const memberIds = [...new Set(members.map(x => x.user_id))]
      if (memberIds.length) {
        const { data: a } = await supabase.from('user_activities')
          .select('user_id, content_id, status').in('user_id', memberIds).eq('status', 'completed')
        acts = a ?? []
      }
    }

    let gDone = 0, gTotal = 0, atRisk = 0
    ;(projects ?? []).forEach(p => {
      const pMembers = [...new Set(members.filter(m => m.project_id === p.id).map(m => m.user_id))]
      PHASES.forEach(n => {
        const cIds = new Set(pathways.filter(pw => pw.project_id === p.id && pw.phase_number === n).map(pw => pw.content_id))
        const steps = cIds.size
        const total = steps * Math.max(pMembers.length, 1)
        const done  = acts.filter(a => pMembers.includes(a.user_id) && cIds.has(a.content_id)).length
        gDone += done; gTotal += total
        const row = phaseRows.find(r => r.project_id === p.id && r.phase_number === n)
        const pct = total > 0 ? Math.round((done / total) * 100) : 0
        if (row?.planned_end && new Date(row.planned_end) < today && pct < 100 && steps > 0) atRisk++
      })
    })

    setTotals({
      clients: (clients ?? []).length,
      projects: projIds.length,
      members: [...new Set(members.map(x => x.user_id))].length,
      pct: gTotal > 0 ? Math.round((gDone / gTotal) * 100) : 0,
      atRisk,
    })
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="bg-[#1F4E79] text-white px-8 py-8">
        <p className="text-xs font-semibold tracking-widest text-white/50 uppercase mb-1">Platform Admin</p>
        <h1 className="text-2xl font-bold">{greeting}, {firstName}</h1>
        <p className="text-white/70 text-sm mt-1">Ask AI across all clients — grounded in your data</p>
      </div>

      <div className="px-8 py-6">
        <AiCanvas
          context="Platform overview across all clients"
          chips={[
            { color: '#1F4E79', tag: 'CLIENTS',  label: 'Clients',        value: totals.clients,  query: 'Show all clients' },
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
