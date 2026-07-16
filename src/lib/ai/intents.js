// ChangeFlow · AI intent matching (pure, no imports)
//
// Split out from rules.js so it carries no Supabase dependency and can be unit-tested in a
// plain node environment. This is the deterministic first tier of the router: map the user's
// text to a grounded intent. Ordered — more specific patterns first.

export const INTENTS = [
  { intent: 'members_behind',      re: /(who('?s| is)?\s+behind|laggard|not (started|done|completed)|behind on|stuck on)/i },
  { intent: 'at_risk',             re: /(at risk|at-risk|overdue|slipping|needs? attention|red flags?|blockers?)/i },
  { intent: 'milestones',          re: /(milestone|due (this|next|soon|in)|deadline|what('?s| is) due|coming up|upcoming)/i },
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
