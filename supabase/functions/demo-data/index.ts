// ChangeFlow — demo-data Edge Function
//
// Serves ONE demo programme (Meridian) to the public /try page, so an anonymous
// visitor can ask CORA real questions against real data.
//
// WHY THIS EXISTS RATHER THAN LETTING THE BROWSER READ THE DATABASE
//   The obvious alternative is an RLS policy letting `anon` read the Meridian
//   tenant. That would be the first anonymous read path into a live tenant
//   database, and the isolation model here is otherwise clean — every table is
//   reachable only by an authenticated member of that client. Rather than open
//   that door for a marketing page, this function reads server-side with the
//   service key and returns a fixed, allow-listed shape.
//
// ALLOW-LIST, NOT BLOCK-LIST
//   Every field returned below is named explicitly. Nothing is `select('*')`.
//   A block-list would only ever exclude the leaks we already thought of; the
//   next column someone adds to `audiences` would ship to the public internet by
//   default. Deliberately NOT returned, at all:
//     · chat_messages / chat_channels  — internal conversation, candid by design
//     · notes on any table             — internal commentary
//     · contact emails, owner_id       — people, even in a demo tenant
//     · ai_usage                       — cost and prompt telemetry
//   Comms owners are reduced to a boolean (`has_owner`), because the story the
//   demo tells is "one message has nobody's name on it" — which needs the
//   absence, not the name.
//
// NO MODEL IS CALLED HERE, AND NONE IS CALLED BY THE PAGE
//   CORA's rules tier computes its answers; the model is a last resort for
//   free-text it cannot ground. The demo runs on fixed questions, so it stays
//   entirely in the computed tier: no tokens, no cost per visitor, nothing to
//   prompt-inject, and the same answer every time — which matters when someone
//   is presenting it.
//
// Deploy: supabase functions deploy demo-data --no-verify-jwt
//   --no-verify-jwt is REQUIRED and intentional: the caller is an anonymous
//   visitor with no session. That is why the allow-list above is the security
//   control, not the auth check.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
}
// Cached at the edge: the demo data changes rarely and every visitor asks the same
// five questions, so this should almost never reach the database.
const json = (body: unknown, status = 200, cache = 300) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': `public, max-age=${cache}` },
  })

// The demo tenant. Kept as a constant rather than a request parameter — a client
// name in the query string would let anyone point this at any tenant they can name.
const DEMO_CLIENT = 'Meridian'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  try {
    const url        = Deno.env.get('SUPABASE_URL')!
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || Deno.env.get('SB_SERVICE_ROLE_KEY') || ''
    if (!serviceKey) return json({ error: 'not configured' }, 503)
    const db = createClient(url, serviceKey)

    // ── The demo client and its busiest project ────────────────────────────
    const { data: client } = await db
      .from('clients').select('id, name, industry')
      .ilike('name', `${DEMO_CLIENT}%`).limit(1).single()
    if (!client) return json({ error: 'demo client not found' }, 404)

    const { data: projects } = await db
      .from('projects').select('id, name, status')
      .eq('client_id', client.id).order('created_at').limit(1)
    const project = projects?.[0]
    if (!project) return json({ error: 'demo project not found' }, 404)

    // ── Everything the page needs, each field named ────────────────────────
    const [phases, milestones, audiences, comms, lanes] = await Promise.all([
      db.from('project_phases')
        .select('phase_number, status, lane_id')
        .eq('project_id', project.id).order('phase_number'),
      db.from('project_milestones')
        .select('name, lane, milestone_date, starts_on, ends_on, color, sort_order')
        .eq('project_id', project.id).order('sort_order'),
      db.from('audiences')
        .select('name, headcount, impact_level, impact_people, impact_process, impact_information, impact_technology, sort_order')
        .eq('project_id', project.id).order('sort_order'),
      db.from('comms_schedule')
        .select('message, audience, size, channel, owner_name, effective_date, derived_status, anchor_name, depends_name, offset_days, sent')
        .eq('project_id', project.id).order('effective_date', { nullsFirst: false }),
      db.from('project_lanes')
        .select('id, name, tint, sort_order')
        .eq('project_id', project.id).order('sort_order'),
    ])

    // owner_name never leaves the server — only whether there is one. The demo
    // story is "this message has no owner", which the boolean carries fine.
    const commsOut = (comms.data ?? []).map(c => ({
      message: c.message, audience: c.audience, size: c.size, channel: c.channel,
      effective_date: c.effective_date, derived_status: c.derived_status,
      anchor_name: c.anchor_name, depends_name: c.depends_name,
      offset_days: c.offset_days, sent: c.sent,
      has_owner: !!c.owner_name,
    }))

    return json({
      generated_at: new Date().toISOString(),
      client:  { name: client.name, industry: client.industry },
      project: { name: project.name, status: project.status },
      lanes:      lanes.data      ?? [],
      phases:     phases.data     ?? [],
      milestones: milestones.data ?? [],
      audiences:  audiences.data  ?? [],
      comms:      commsOut,
    })
  } catch (e) {
    // Never echo the error to an anonymous caller — it would describe the schema.
    console.error('demo-data failed:', e)
    return json({ error: 'unavailable' }, 500)
  }
})
