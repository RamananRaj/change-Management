// ChangeFlow · AI intent matching (pure, no imports)
//
// Split out from rules.js so it carries no Supabase dependency and can be unit-tested in a
// plain node environment. This is the deterministic first tier of the router: map the user's
// text to a grounded intent. Ordered — more specific patterns first.

export const INTENTS = [
  { intent: 'my_readiness',        re: /(my readiness|my surveys?|my (rag|score)|how ready am i)/i },
  { intent: 'my_progress',         re: /(my progress|my journey|my phases|my steps|my completion|how am i doing|where am i)/i },
  { intent: 'report',              re: /(report|wrap[- ]?up|status (report|update|pack)|exec(utive)?[- ]?(pack|summary|report|brief(ing)?)|board[- ]?pack|briefing[- ]?pack|change[- ]?pack|full (picture|rundown))/i },
  // Stakeholder impact — people ask this many ways ("who's most impacted", "high impacted
  // stakeholders", "impact assessment"), so match the concept, not just the artifact's name.
  { intent: 'heatmap',             re: /(heat ?map|impact map|stakeholder map|stakeholder impact|impact(ed)? stakeholders?|(most|high(ly)?|highest|worst) impacted|who (is|are|'?s) .*impact|impact assessment|impacted groups?)/i },
  { intent: 'members_behind',      re: /(who('?s| is)?\s+behind|laggard|not (started|done|completed)|behind on|stuck on)/i },
  { intent: 'at_risk',             re: /(at risk|at-risk|overdue|slipping|needs? attention|red flags?|blockers?)/i },
  { intent: 'upcoming',            re: /(upcoming|coming up|what('?s| is) next|phase starts?|what('?s| is) ahead|road ?ahead)/i },
  { intent: 'milestones',          re: /(milestone|due (this|next|soon|in)|deadline|what('?s| is) due)/i },
  { intent: 'clients',             re: /(clients|which client|list client|show client|all client)/i },
  { intent: 'people',              re: /(all people|list people|show people|people list|team members?|everyone|who('?s| is) on the)/i },
  { intent: 'progress',            re: /(progress|completion|how far|on track|percent|% (done|complete))/i },
  { intent: 'readiness',           re: /(readiness|rag status|how are we|overall health|summary|summarise|summarize|how('?s| is) it going)/i },
]

// Returns { intent, params } or null. params.phase captured when the text names one.
export function matchIntent(text) {
  const t = (text ?? '').trim()
  if (!t) return null
  for (const { intent, re } of INTENTS) {
    if (re.test(t)) {
      const params = {}
      const phase = t.match(/phase\s*([1-5])/i)
      if (phase) params.phase = Number(phase[1])
      return { intent, params }
    }
  }
  return null
}
