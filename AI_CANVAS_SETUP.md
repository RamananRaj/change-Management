# ChangeFlow · AI Canvas — setup & architecture

A grounded, role-scoped AI assistant on the dashboard. Collapsed KPI chips over an open
canvas the AI fills with widgets (heat maps, risk lists, progress, readiness). Answers are
**grounded in your real data** and **scoped by RLS** (Master Admin → all clients, Client
Admin → theirs, member → their own projects).

Everything Master Admin had before is untouched — this is purely additive.

**Where it appears:** the reusable `AiCanvas` component (`src/components/AiCanvas.jsx`) powers
both (a) the standalone `/canvas` page and (b) an inline **Dashboard ⇄ AI** toggle on the
Master Admin dashboard. In AI mode the dashboard's own KPIs (Clients, Projects, People, Avg
completion, Need attention) collapse into the chip strip and the canvas opens below — the
full dashboard remains the default view, nothing is removed. (Client Admin / Member dashboards
get the same toggle next.)

## The tiered router (Rules → local SLM → external)

Every question flows down this ladder and stops at the first tier that can answer:

1. **Local Rules** (`src/lib/ai/rules.js`) — deterministic intent match → a grounded Supabase
   query. Free, instant, private; no model touches your numbers. Current capabilities:
   at-risk items, milestones due, progress by project, readiness summary, members behind on a
   phase. New capabilities get added one at a time (each is a small intent + grounded query).
2. **Local SLM** (`src/lib/ai/slm.js`) — an in-browser model (WebLLM/WebGPU) for open-ended
   phrasing the rules can't match. Runs on the user's own device: **$0 server cost**, and the
   prompt never leaves the browser. System-prompted to never invent figures.
3. **External model** (`supabase/functions/ai-complete`) — last resort, only if the SLM is
   off/unavailable. The **only** tier where data can leave the environment; these answers are
   flagged `external` in the UI and `escalated=true` in telemetry.

The tier is an implementation detail — it is **not** shown on answers. It is only visible to
admins in **System Admin → AI Usage**.

## 1. Run the SQL (Supabase → SQL editor)

```
supabase/add_ai_canvas.sql
```

Creates `ai_usage` — one row per answered query (tier, intent, query preview, latency,
escalated). RLS: users insert their own; Master Admin reads all; Client Admin reads their
client's. Capability-specific tables get added later, as each capability is built.

## 2. (Optional) Enable the in-browser SLM

Off by default (the model is a few hundred MB, so it isn't auto-downloaded). Enable per device:

```js
localStorage.setItem('cf_ai_slm', 'on')   // then reload
```

It lazy-loads on the first open-ended question and caches after that. Requires a WebGPU
browser (recent Chrome/Edge). Swap the model in `slm.js` (`MODEL`) for a larger one if desired.
The provider sits behind a stable interface — later you can point it at a self-hosted Ollama
endpoint without changing the router or UI.

## 3. (Optional) Configure the external fallback

Nothing leaves the environment until you set a key. Then:

```
supabase secrets set AI_PROVIDER=anthropic AI_PROVIDER_KEY=sk-...   # or AI_PROVIDER=openai
supabase functions deploy ai-complete
```

With no key the function returns `configured:false` and the UI shows a graceful message
instead of sending anything off-device.

## Adding a capability (the "one by one" pattern)

Each new grounded answer is small and self-contained:

1. Add an intent + regex to `src/lib/ai/intents.js`.
2. Add a `run<Name>()` grounded query to `src/lib/ai/rules.js` and register it in `RUNNERS`.
3. If it needs a new widget shape, add a case to `WidgetBody` in `Canvas.jsx`; otherwise reuse
   `list` / `progress` / `narrative`.
4. If it needs new data, add a table + RLS in a new SQL file.
5. Add a phrasing case to `rules.test.js`.

No router, telemetry, or UI-shell changes needed — the framework absorbs it.

## 4. Deploy the app

Standard `git push` → Vercel. No new npm dependencies (WebLLM is a CDN import), so the build
is unchanged.

## Files

| File | Role |
|------|------|
| `src/lib/ai/intents.js` | Pure intent matcher (unit-tested, no deps) |
| `src/lib/ai/rules.js` | Grounded, RLS-scoped queries per intent + chip summary |
| `src/lib/ai/slm.js` | In-browser WebLLM provider (opt-in) |
| `src/lib/ai/external.js` | External fallback client |
| `src/lib/ai/router.js` | Rules → SLM → external orchestration + logging |
| `src/lib/ai/telemetry.js` | Best-effort `ai_usage` logging |
| `src/pages/Canvas.jsx` | The AI Canvas page (`/canvas`) |
| `src/components/SystemAdmin.jsx` | + "AI Usage" sub-tab |
| `supabase/functions/ai-complete/` | External model proxy (guarded) |
| `supabase/add_ai_canvas.sql` | `ai_usage` telemetry table |

## Testing

`src/lib/ai/rules.test.js` covers intent matching (current phrasings + phase capture + null
cases). Runs under Vitest (`npm test`) in a normal environment; in this sandbox Vitest/rollup
can't boot, so it's verified by running `intents.js` directly under node.
