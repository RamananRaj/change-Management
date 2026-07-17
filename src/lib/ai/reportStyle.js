// ChangeFlow · report style pass (opt-in, on-device SLM)
//
// Rewrites the report's NARRATIVE sections in the house style — grounded on the facts the rules
// already computed. The model only rephrases; it must not add or change any figure. Learned
// edits (client + standard) serve as the style exemplars. Runs on the in-browser SLM, so client
// data never leaves the device. Deterministic template text is always the fallback.

import { slmAvailable, slmGenerate } from './slm'
export { slmAvailable }

const SYSTEM = [
  "You are ChangeFlow's report editor. Rewrite the given text to match the house style shown in the examples.",
  'HARD RULE: keep every fact, number, percentage, name and date EXACTLY as written — never add, remove, or alter a fact.',
  'Improve only phrasing, tone and flow. Keep it concise (1–3 sentences). Return ONLY the rewritten text — no preamble, no quotes.',
].join(' ')

// Returns a new sections array with generated narrative sections rewritten. Sections already
// sourced from a client/standard edit are left as-is (they're already in-voice). onProgress
// forwards model-download + step updates.
export async function rewriteReportNarratives(sections, onProgress) {
  const examples = sections.filter(s => s.type === 'narrative' && s.source && s.body).map(s => s.body).slice(0, 3)
  const targets = sections.filter(s => s.type === 'narrative' && !s.source)
  if (!targets.length) return sections

  const out = []
  let i = 0
  for (const s of sections) {
    if (s.type === 'narrative' && !s.source) {
      i++
      onProgress?.({ text: `Styling section ${i}/${targets.length}…` })
      const user = `${examples.length ? `House style examples:\n${examples.map(e => `- ${e}`).join('\n')}\n\n` : ''}Rewrite this, preserving all facts and numbers exactly:\n${s.body}`
      try {
        const r = (await slmGenerate(SYSTEM, user, onProgress)).trim()
        out.push({ ...s, body: r || s.body, source: 'slm' })
      } catch {
        out.push(s)   // fall back to the deterministic text
      }
    } else {
      out.push(s)
    }
  }
  return out
}
