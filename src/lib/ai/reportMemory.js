// ChangeFlow · report memory — the platform "learns" an admin's report edits and adopts them.
// Edited narrative sections are saved per client as a versioned 'report_edits' artifact; a
// later report generation merges them in. Re-editing supersedes (new version, is_current).

import { supabase } from '../supabase'

// edits: { "<section heading>": "<edited text>", ... }
export async function saveReportEdits(clientId, edits) {
  if (!clientId) return new Error('This report has no client to learn against.')
  if (!edits || !Object.keys(edits).length) return null

  const { data: cur } = await supabase.from('change_artifacts')
    .select('id, version, data').eq('client_id', clientId).eq('type', 'report_edits').eq('is_current', true)
    .order('version', { ascending: false }).limit(1)
  const prev = cur?.[0]
  const merged = { ...(prev?.data ?? {}), ...edits }   // newest edits win, older ones kept

  if (prev) {
    await supabase.from('change_artifacts').update({ is_current: false }).eq('id', prev.id)
    const { error } = await supabase.from('change_artifacts').insert({
      client_id: clientId, type: 'report_edits', title: 'Report narrative edits',
      version: (prev.version ?? 1) + 1, is_current: true, data: merged, source: 'admin edit',
    })
    return error
  }
  const { error } = await supabase.from('change_artifacts').insert({
    client_id: clientId, type: 'report_edits', title: 'Report narrative edits',
    version: 1, is_current: true, data: edits, source: 'admin edit',
  })
  return error
}
