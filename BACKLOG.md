# ChangeFlow — Backlog / Items to Address

_Last updated: 14 Jul 2026_

A running list of open work and considerations. Grouped by priority. Check off as done.

---

## Open — from our build list

- [ ] **Client Admin Stakeholders tab** — the data model supports per-client stakeholders (Option B) and the Master Admin manager exists, but Client Admins still can't pick their own impacted stakeholders. Surface a Stakeholders tab inside the Client Admin page. _(Finishes an earlier decision.)_
- [x] **Content Manager grouping** — group by industry when "All industries" is selected (collapsible, counts, expand/collapse all); flat list for a specific industry.
- [ ] **View-as into phase pages (#29)** — _parked._ Master Admin can preview a member's dashboard read-only, but not walk the actual phase pages / drawers / submitted answers. Extend the read-only "view as" identity into phase pages + write-guards. Build only if Master Admin asks for it.
- [ ] **`template_responses` admin-read policy** — so the "view as member" preview shows an accurate template count for a real member.
- [ ] **Repo cleanup** — commit or `git restore` the stray `supabase/seed_test_user_profile.sql`; consider dropping the now-unused `client_pathways` table once per-project pathways are confirmed everywhere.

## Considerations — to round out the product

- [ ] **Notifications / in-app nudges** — members get no reminder to complete steps. Even an in-app "you have N steps due" would drive the completion the dashboards measure. _(Email needs a provider; in-app is doable now.)_
- [ ] **Reporting / export** — a PDF or Excel of a project's progress + timeline for stakeholders who won't log in.
- [ ] **Survey assignment** — surveys are global; tie them to a project/phase with a due date to close the loop with the readiness (RAG) shown on dashboards.
- [ ] **Empty-state + mobile polish** — dashboards assume data exists; first-run states and small-screen layouts need a pass.
- [~] **Automated testing** — Vitest suite live for pure logic + the admin authorization matrix (`src/lib/logic.test.js`). Still to add: component render tests (React Testing Library) and mocked-Supabase integration tests.

## System Health / testing follow-ups

- [ ] **Refactor dashboards to import `src/lib/logic.js`** — RAG, access level, at-risk, upcoming, phase status are now canonical + tested in `logic.js` but still inlined in Dashboard/Master/Client components. Point them at the module for a single source of truth.
- [ ] **Component render tests** — React Testing Library tests for SystemAdmin table, dashboards, and the preview flow (needs jsdom env).
- [~] **Edge Function integration tests** — `src/integration/edgeFunctions.test.js` invokes the deployed `admin-user-actions` (ping + unknown-action guard, opt-in reset). Skipped unless `TEST_SUPABASE_URL` / admin creds are set. This is the class of test that would have caught the missing service-role key. To extend: add lock/unlock + edit assertions against a throwaway test user, and wire into CI with test secrets.
- [ ] **Password-reset E2E** — exercise the full reset loop against a dedicated test inbox (trigger reset → confirm recovery link works via `/auth/reset`). Not suitable for the live health dashboard (sends real email).
- [x] **Scheduled health auto-runs** — `health-check` Edge Function + pg_cron every 15 min + `health_runs` history, shown in the System Health tab (scheduled/manual, pass rates). Secret: `HEALTH_CRON_SECRET` (Supabase secrets). Cron job: `changeflow-health-check`.
- [ ] **Lock/delete via backend confirmed** — done via `admin-user-actions`; consider soft-deactivate flag as a reversible alternative to hard delete.

---

## AI Canvas — follow-ups

- [x] **AI Canvas framework** — `/canvas` page: collapsed KPI chips → grounded widgets. Tiered router (Rules → in-browser SLM → external), telemetry to `ai_usage`, System Admin "AI Usage" tab. SQL: `add_ai_canvas.sql`. Setup: `AI_CANVAS_SETUP.md`. Master Admin flows untouched (purely additive). Current intents: at-risk, milestones-due, progress, readiness, members-behind. Capabilities added one at a time from here.
- [ ] **Stakeholder impact heat map** — deferred (needs an impact-capture step). When built: add `stakeholder_impact` table + RLS, a capture grid (Client Admin → Stakeholders) to score stakeholder × phase 0–100, the `stakeholder_heatmap` intent, and the heat-map widget renderer.
- [ ] **Self-hosted SLM option** — provider interface is in place (`slm.js`); add an Ollama-endpoint provider as an alternative to in-browser WebLLM for orgs that prefer a central model.
- [ ] **More rule intents** — survey response rates, comms draft, per-client comparison. Each new grounded intent keeps work off the model (see "Adding a capability" in the setup doc).
- [ ] **Vitest in CI** — `rules.test.js` verified via node in-sandbox; run under real Vitest in CI.
- [ ] **Admin AI console (cockpit)** — reskin Platform Admin (and Client Admin) to the AI theme: pill-tab module nav + a "Cockpit" 360° client-health landing (cards with Onboarding/Activity/People/Progress/Timeline chips) + an admin "Ask" pill. Mockup: `changeflow_admin_cockpit_mockup.html`. Phase it: shell + Cockpit first, then modules to cards. Keep existing modal forms behind it initially.
- [ ] **AI-assisted form/template creation** — (after the admin cockpit) attach a template file (Excel/doc) in Platform Admin and have the AI parse it and create the content/template entry (infer columns, phase, type). Builds on the existing Excel→column import in the Templates builder + the admin Ask pill.
- [ ] **Lean entity resolver (when data grows)** — the generic resolver in `rules.js` currently does a full `loadData()` per freeform question to match a named client/project/person/stakeholder. Fine at current size; when it gets slow, switch to a cheap name-only index first (query just id+name per table), then load full detail only on a hit, and cache the catalog. Extend candidates to surveys/invites/content as those become question-worthy.

## Solution size review (follow-up)

- [ ] **Review the size of the solution** — two related things, worth one sitting:
  - *Bundle*: production build is a single 977 kB chunk (246 kB gzipped) and Vite now warns on it. Fine at current user counts; the first lever is route-level `React.lazy` on the admin surfaces (`Admin.jsx`, `SystemAdmin.jsx`, `AdminClients.jsx` are ~4,900 lines between them and most users never open them).
  - *Codebase*: ~16,300 lines across `src/`. The largest files are `Admin.jsx` (2,008), `AdminClients.jsx` (1,632), `SystemAdmin.jsx` (1,278), `rules.js` (1,036). `SystemAdmin.jsx` in particular is now seven unrelated sub-tabs in one file and is the obvious first split.
  - Decide at review time whether either is actually causing pain (slow first load, hard-to-navigate files) or whether it's just large-but-fine. Splitting has a cost and shouldn't be done on principle alone.

## Recently shipped (context)

- System Health sub-tab (DB ping, table/RPC/Edge-function live checks) + Vitest suite (17 tests, auth matrix).
- Full user management (edit / reset link / lock / delete) via `admin-user-actions` Edge Function; Master Admin (System Admin tab) + Client Admin (Users tab, scoped).
- System Admin hub: User Management by Client + Pending Invites.

- Role-aware dashboards (member journey / client roll-up / platform overview).
- Master Admin dashboard: needs-attention, upcoming milestones, RAG per client, per-project mini timeline; expand/collapse.
- Client Admin dashboard (cut-down): same insights scoped to one client, projects expand to per-member progress.
- Member dashboard: timeline strip, at-risk banner, upcoming milestones.
- Master Admin "view as member" (persona preview + specific-member view).
- Password reset flow + robust sign-in; Client Admin elevation (toggle + invite-as-admin).
- Timeline colour + progress scoped to project pathway; pathway editor in-path / not-in-path grouping.
