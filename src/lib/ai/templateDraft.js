// ChangeFlow · AI-assisted template creation
//
// Deterministic parse + draft, then a guarded write. The admin attaches an Excel/CSV file
// and asks "add this template for <customer>"; we parse columns (same inference as the
// Templates builder), match the customer by name, infer the phase, and return a DRAFT.
// Nothing is written until createTemplate() is called after the admin confirms.

import { supabase } from '../supabase'

async function xlsx() {
  if (typeof window !== 'undefined' && window.XLSX) return window.XLSX
  await new Promise((resolve, reject) => {
    const s = document.createElement('script')
    s.src = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js'
    s.onload = resolve; s.onerror = reject
    document.head.appendChild(s)
  })
  return window.XLSX
}

// Parse the first sheet's header row into column definitions, inferring types from sample rows.
export async function parseTemplateFile(file) {
  const X = await xlsx()
  const buf = await file.arrayBuffer()
  const wb = X.read(buf)
  const sheet = wb.Sheets[wb.SheetNames[0]]
  const rows = X.utils.sheet_to_json(sheet, { header: 1 })
  if (!rows?.length) return []
  const headers = rows[0]
  const dataRows = rows.slice(1, 6)
  return headers.filter(Boolean).map(h => {
    const idx = headers.indexOf(h)
    const samples = dataRows.map(r => r[idx]).filter(v => v !== undefined && v !== '' && v !== null)
    let type = 'text', options = []
    if (samples.length) {
      const nums = samples.map(Number)
      const allNums = samples.every(v => !isNaN(Number(v)))
      const int15 = allNums && nums.every(n => n >= 1 && n <= 5 && Number.isInteger(n))
      const uniq = [...new Set(samples.map(String))]
      if (int15 && samples.length >= 2) type = 'rating'
      else if (allNums) type = 'number'
      else if (uniq.length <= 5 && samples.length >= 3) { type = 'select'; options = uniq }
    }
    return {
      key: String(h).toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, ''),
      label: String(h).trim(), type, required: false,
      ...(options.length ? { options } : {}),
    }
  })
}

const PHASE_WORDS = { diagnose: 1, design: 2, engage: 3, embed: 4, evaluate: 5 }

// Build a draft template from the file + the admin's prompt. Deterministic; no write.
export async function buildTemplateDraft(file, prompt) {
  const columns = await parseTemplateFile(file)
  const t = (prompt || '').toLowerCase()

  // Target customer: match a known client name in the prompt (RLS scopes what's visible).
  const { data: clients } = await supabase.from('clients').select('id, name')
  const client = (clients ?? []).find(c => c.name && c.name.length >= 3 && t.includes(c.name.toLowerCase())) || null

  // Phase: "phase N" or a phase name; default 1.
  const pm = t.match(/phase\s*([1-5])/)
  const phase = pm ? Number(pm[1]) : (Object.entries(PHASE_WORDS).find(([w]) => t.includes(w))?.[1] ?? 1)

  // Title: "called/named/titled X", else the file name.
  const tm = prompt.match(/(?:called|named|titled|title)\s+["']?([^"'\n]+?)["']?$/i)
  const title = tm ? tm[1].trim() : file.name.replace(/\.(xlsx|xls|csv)$/i, '').replace(/[_-]+/g, ' ').trim()

  return { title, phase_number: phase, client_id: client?.id ?? null, client_name: client?.name ?? null, columns, fileName: file.name }
}

// The guarded write — called only after the admin confirms the draft.
export async function createTemplate(draft) {
  const { error } = await supabase.from('templates').insert({
    title: draft.title,
    phase_number: draft.phase_number,
    client_id: draft.client_id,
    columns: draft.columns,
    is_active: true,
  })
  return error
}
