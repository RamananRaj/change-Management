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
- [x] **Scheduled health auto-runs** — `health-check` Edge Function + pg_cron every 15 min + `health_runs` history, shown in the System Health tab (scheduled/manual, pass rates). Secret: `HEALTH_CRON_SECRET` (Supabase secrets). Cron job: `changeflow-health-check`.
- [ ] **Lock/delete via backend confirmed** — done via `admin-user-actions`; consider soft-deactivate flag as a reversible alternative to hard delete.

---

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
