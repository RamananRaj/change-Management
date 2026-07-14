# ChangeFlow — Backlog / Items to Address

_Last updated: 11 Jul 2026_

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
- [ ] **Automated testing** — no test coverage yet; add at least smoke/unit tests around auth, RLS-sensitive queries, and the dashboards.

---

## Recently shipped (context)

- Role-aware dashboards (member journey / client roll-up / platform overview).
- Master Admin dashboard: needs-attention, upcoming milestones, RAG per client, per-project mini timeline; expand/collapse.
- Client Admin dashboard (cut-down): same insights scoped to one client, projects expand to per-member progress.
- Member dashboard: timeline strip, at-risk banner, upcoming milestones.
- Master Admin "view as member" (persona preview + specific-member view).
- Password reset flow + robust sign-in; Client Admin elevation (toggle + invite-as-admin).
- Timeline colour + progress scoped to project pathway; pathway editor in-path / not-in-path grouping.
