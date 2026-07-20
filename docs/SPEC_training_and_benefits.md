# Spec — Audiences, Training Needs Analysis, Benefits Realisation

Status: draft for review · Written 20 Jul 2026

Three builds in dependency order. Audiences is a prerequisite for the other two and for
comms and gates, so it comes first regardless of which of the others you choose.

---

## 0. Audiences — the prerequisite

### Why first

Four features are blocked on the same missing concept. Comms can't name who a message
goes to. Gates can't score by business unit. Training needs can't say who needs what.
The heat map can't tie impact to headcount.

Today the nearest things are `stakeholders` and `role_mappings` — both **global**
pick-lists (`name, detail, is_active, sort_order`), not scoped to a client or project,
with no size, no membership and no impact rating. They populate dropdowns. They cannot
answer "how many people are in Contact Centre".

### Tables

```sql
-- A group of people a change lands on. Project-scoped: the same organisation splits
-- differently for a billing change than for a depot restructure, and forcing one
-- global list makes both wrong.
create table audiences (
  id           uuid primary key default gen_random_uuid(),
  project_id   uuid not null references projects(id) on delete cascade,
  name         text not null,                      -- 'Contact Centre'
  parent_id    uuid references audiences(id),      -- optional roll-up (Operations → Billing)
  headcount    int,                                -- null = unknown, NOT zero
  impact_level text check (impact_level in ('vh','h','m','l','vl','none')),
  owner_id     uuid references auth.users(id),     -- who speaks for this group
  notes        text,
  sort_order   int default 0,
  created_at   timestamptz default now(),
  unique (project_id, name)
);

-- Which ChangeFlow roles sit in which audience. Optional — an audience is valid with
-- a headcount and no named members, which is the common case early on.
create table audience_roles (
  audience_id uuid not null references audiences(id) on delete cascade,
  role_id     uuid not null references role_mappings(id) on delete cascade,
  primary key (audience_id, role_id)
);
```

`headcount` is nullable on purpose. An audience whose size nobody knows must read as
unknown, never as zero — the same reasoning as "not assessed" on the readiness gate.
A zero silently makes every percentage denominator wrong.

### Wiring to what exists

- **Heat map** — `audiences.impact_level` replaces the hand-authored `stakeholder_heatmap`
  artifact rows. The renderer already exists; only the source changes.
- **Gates** — `readiness_gate.units[].unit` becomes `audience_id`.
- **Comms** — `comms_plan.items[].audience` becomes `audience_id`, and `size` stops being
  typed by hand.
- **CORA** — one new intent (`audiences`), and `resolveScope` gains nothing: audiences are
  looked up within an already-resolved project.

### Migration path

Existing demo artifacts keep working. Read `audience_id` when present, fall back to the
text field when not — the same pattern used for `project_milestones.lane` → `lane_id`.

---

## 1. Training needs analysis

### The constraint that shapes everything

**480 Meridian staff need training and none of them will ever log into ChangeFlow.**

This is the single most important design fact. `user_activities` tracks completion for
ChangeFlow *members* — the change team, a handful of people. End-user training completion
is a different population an order of magnitude larger, most of whom have no account and
never will.

So training completion cannot be a person ticking a box in this app. It arrives by import
or integration, keyed on an employee identifier the client already uses.

### Tables

```sql
-- A unit of training. Client-scoped so a module can be reused across that client's
-- programmes without leaking into another client's library.
create table training_modules (
  id          uuid primary key default gen_random_uuid(),
  client_id   uuid not null references clients(id) on delete cascade,
  project_id  uuid references projects(id) on delete cascade,  -- null = reusable
  name        text not null,
  description text,
  delivery    text check (delivery in ('classroom','virtual','elearning','floor_walking','self_serve')),
  duration_min int,
  prerequisite_id uuid references training_modules(id),
  created_at  timestamptz default now()
);

-- The needs analysis itself: which audience needs which module, and how firmly.
create table training_needs (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references projects(id) on delete cascade,
  audience_id uuid not null references audiences(id) on delete cascade,
  module_id   uuid not null references training_modules(id) on delete cascade,
  necessity   text not null default 'required'
              check (necessity in ('required','recommended','optional')),
  target_pct  int default 90 check (target_pct between 0 and 100),
  due_on      date,
  created_at  timestamptz default now(),
  unique (audience_id, module_id)
);

-- Completion, per PERSON, keyed on the client's own identifier rather than auth.users.
-- Most of these people have no ChangeFlow account and never will.
create table training_completions (
  id           uuid primary key default gen_random_uuid(),
  project_id   uuid not null references projects(id) on delete cascade,
  module_id    uuid not null references training_modules(id) on delete cascade,
  audience_id  uuid references audiences(id) on delete set null,
  person_ref   text not null,             -- employee id / email as the client keys it
  person_name  text,
  status       text not null default 'completed'
               check (status in ('enrolled','completed','exempt','failed')),
  completed_on date,
  source       text,                      -- 'csv:2026-11-12' | 'lms:cornerstone' | 'manual'
  created_at   timestamptz default now(),
  unique (module_id, person_ref)
);

create index on training_completions (project_id, audience_id, module_id);
```

`person_ref` is deliberately `text`, not a foreign key. Tying it to `auth.users` would
mean creating 480 accounts nobody uses — the exact mistake that makes these modules
unusable in the field.

### Derived, not stored

Coverage is always computed, never written:

```
coverage(audience, module) = completions(status='completed') / audiences.headcount
```

Storing it would let it drift from the completions that produce it. When `headcount` is
null, coverage is **unknown** — not zero, and not 100%.

### Wiring to what exists

- **Gate criteria** — "Trained users signed off, 88% against 90% target" stops being typed
  by a person and becomes a computed criterion. This is the single most visible win.
- **Comms** — the blocked "Training enrolment reminder" resolves, because the audience of
  un-enrolled people becomes queryable: everyone in the audience with no completion row.
- **Timeline** — training modules with `due_on` can render in the Training sub-lane
  alongside the existing bars.
- **CORA** — new `training` intent; the programme story gains a "Are people trained"
  section between "Are we ready" and "What needs a decision".
- **Report** — one more section, using the existing list renderer.

### Import

CSV first, one file, four columns: `person_ref, person_name, module, completed_on`.
Match module by name within the project; report unmatched rows rather than silently
dropping them. An LMS integration is the same shape with a different transport, and
should not be attempted until a client asks for a specific LMS.

---

## 2. Benefits realisation

### The design problem

The naive build — a table of benefits with baseline, target, actual, and a form to update
the actual — is abandoned within two quarters, reliably. Updating it is someone's
unrewarded side job and nothing breaks when they stop. A benefits module full of stale
numbers damages trust more than not having one.

Three decisions change the odds:

1. **Quarterly cadence, not monthly.** Fewer, larger asks survive longer.
2. **Derive what already exists.** Adoption, usage and confidence come from surveys and
   activity data you already hold. Only genuinely external measures get typed.
3. **Link each benefit to the change activity meant to deliver it.** This is the
   differentiator and the retention hook.

That third one produces a sentence no competitor's tool can: *"Call handling time hasn't
moved, and Contact Centre training is 60% complete."* Benefits tools don't hold change
activity; change tools don't hold benefits. You'd hold both.

### Tables

```sql
create table benefits (
  id            uuid primary key default gen_random_uuid(),
  project_id    uuid not null references projects(id) on delete cascade,
  name          text not null,                    -- 'First-contact resolution'
  description   text,
  measure_unit  text,                             -- '%', 'minutes', '$'
  direction     text not null default 'up' check (direction in ('up','down')),
  baseline      numeric,
  baseline_on   date,
  target        numeric,
  target_on     date,
  owner_id      uuid references auth.users(id),
  status        text not null default 'tracking'
                check (status in ('tracking','realised','at_risk','abandoned')),
  created_at    timestamptz default now()
);

-- Actuals over time. Append-only: a benefit's history is the evidence, and
-- overwriting a single "current" value destroys the argument the module exists to make.
create table benefit_measures (
  id          uuid primary key default gen_random_uuid(),
  benefit_id  uuid not null references benefits(id) on delete cascade,
  measured_on date not null,
  value       numeric not null,
  source      text,                    -- 'manual' | 'survey:<id>' | 'import'
  note        text,
  created_at  timestamptz default now(),
  unique (benefit_id, measured_on)
);

-- The differentiator: what change activity is meant to move this benefit.
create table benefit_drivers (
  benefit_id  uuid not null references benefits(id) on delete cascade,
  driver_type text not null check (driver_type in ('phase','milestone','training_module','audience','comms')),
  driver_id   uuid not null,
  note        text,
  primary key (benefit_id, driver_type, driver_id)
);
```

`benefit_measures` is append-only by design. The value of this module is the trend line
and the evidence trail; a single mutable "current value" column throws both away.

### Wiring to what exists

- **Drivers** point at `project_phases`, `project_milestones`, `training_modules` and
  `audiences` — all existing or specified above. No new concepts.
- **Derived measures** — a benefit whose `source` is a survey pulls its value from
  `survey_responses` automatically on the quarterly cadence, so it needs no human input.
- **CORA** — new `benefits` intent, and a "Is it working" section that only appears
  post-go-live.
- **Report** — a benefits section for the executive pack, which is where the demand
  actually comes from.

### Anti-abandonment

- A benefit with no measure in 120 days auto-flags as `at_risk` **on data staleness**,
  not on performance — and says so, so a stale benefit is visible rather than silently wrong.
- CORA's story names the gap: *"three benefits have no measurement since March."*
- The quarterly prompt goes to the named `owner_id`, through the existing notification
  plumbing.

---

## Build order and effort

| Step | What | Depends on | Rough size |
|---|---|---|---|
| 1 | Audiences (tables, CRUD, wire heat map / gate / comms to it) | — | Small |
| 2 | Training modules + needs matrix | Audiences | Small |
| 3 | Training completions + CSV import | Step 2 | Medium |
| 4 | Computed gate criterion + CORA training intent + report section | Step 3 | Small |
| 5 | Benefits tables + quarterly capture | Audiences | Medium |
| 6 | Benefit drivers + the correlation view | Steps 3, 5 | Medium |

Steps 1–4 are the coherent first release: they make three things that are currently
hand-maintained become computed, which is the demonstrable value.

Steps 5–6 are the better sales story and the worse first build. Hold until a client asks —
the abandonment risk is real and it is not mitigated by building it well.

## Open questions

1. **Audience membership** — do we need named people in an audience, or is headcount plus
   an owner enough for the first release? Headcount-only is far cheaper and probably right,
   but it caps what comms can eventually do.
2. **Module reuse across clients** — `training_modules.client_id` is required above.
   Should there be a global library like `phase_content`, promotable per client?
3. **Who imports completions** — Client Admin, or Master Admin only? It's bulk data
   affecting gate status, which argues for the tighter permission.
4. **Benefit measure entry** — in-app form, or CSV alongside training? One import path is
   easier to teach than two.
