-- ChangeFlow: the comms plan, anchored to milestones and honest about "blocked".
-- =============================================================================
-- THE PROMISE THIS DELIVERS
--   "Communications anchored to milestones — move Go-Live and the cascade moves;
--    a blocked upstream output reads as blocked, not merely late."
--
--   Until now the comms plan was a hand-authored JSONB artifact: the date was typed,
--   the status ('blocked'/'overdue'/'sent') was typed, and nothing moved when the
--   timeline moved. The words were right and the data was static. This makes both the
--   date and the status DERIVED, so the plan tells the truth without anyone maintaining
--   it by hand.
--
-- TWO THINGS ARE COMPUTED, NEVER STORED
--   1. The date. An item anchors to a milestone with an offset ("−7 days from Go-Live").
--      Its date is the milestone's date plus the offset, so moving the milestone on the
--      timeline moves every item anchored to it. An item can instead pin to a fixed
--      calendar date (a newsletter, a regulatory deadline) that does not move.
--
--   2. The status. When an item is past due and not sent, the platform asks WHY:
--        · the upstream output it waits on has not happened yet  → BLOCKED
--        · nothing is stopping it; it simply did not go out       → OVERDUE
--      "Blocked" and "late" are different problems with different owners, and the plan
--      must not collapse them into one amber dot.
--
-- THE ADMIN CAN STILL OVERRIDE
--   Cascading is the default, not a cage. An item carries an optional override_date: set
--   it to "revise" an item away from its anchor (the plan flags it as detached); clear it
--   to "accept the move" and re-track the milestone. The decision is recorded, not
--   inferred — the same pattern as phase release mode.
--
-- Safe to re-run.

-- ─────────────────────────────────────────────────────────────
-- 1. The table — one row per planned communication
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.comms_items (
  id            uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id    uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,

  -- What is being said, to whom, how.
  message       text NOT NULL,
  audience      text,
  size          int,                       -- headcount reached; NULL = unknown, not zero
  channel       text,
  owner_name    text,                      -- who sends it; NULL surfaces as "no owner"

  -- ── Anchoring: a milestone + offset, OR a fixed date ──────────────────────
  -- The date is derived from whichever is set. A CHECK below requires one of them, so
  -- an item can never exist with no way to place it on a calendar.
  anchor_milestone_id uuid REFERENCES public.project_milestones(id) ON DELETE SET NULL,
  offset_days   int NOT NULL DEFAULT 0,    -- relative to the anchor milestone's date
  fixed_date    date,                      -- used when there is no anchor milestone

  -- ── Admin override ("revise") ─────────────────────────────────────────────
  -- When set, this wins over the derived date and the item is reported as detached from
  -- its anchor. NULL = the item tracks its milestone (the cascade).
  override_date date,

  -- ── The upstream output this waits on ─────────────────────────────────────
  -- A milestone that must be reached before this message can go. If the item is due and
  -- this milestone has not been reached, the item is BLOCKED rather than merely overdue.
  depends_on_milestone_id uuid REFERENCES public.project_milestones(id) ON DELETE SET NULL,

  -- ── Has it gone out? ──────────────────────────────────────────────────────
  sent          boolean NOT NULL DEFAULT false,
  sent_on       date,

  notes         text,
  sort_order    int NOT NULL DEFAULT 0,
  created_at    timestamptz DEFAULT now(),

  -- An item needs at least one way to be placed on a calendar.
  CONSTRAINT comms_items_has_anchor
    CHECK (anchor_milestone_id IS NOT NULL OR fixed_date IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_comms_items_project ON public.comms_items(project_id);
CREATE INDEX IF NOT EXISTS idx_comms_items_anchor  ON public.comms_items(anchor_milestone_id);
CREATE INDEX IF NOT EXISTS idx_comms_items_dep     ON public.comms_items(depends_on_milestone_id);

-- Anchor and dependency must belong to the SAME project as the item. Without this an item
-- could quietly anchor to another programme's Go-Live and derive a nonsense date that
-- reads as real. Enforced in a trigger because a CHECK cannot reference other tables.
CREATE OR REPLACE FUNCTION public.comms_items_same_project()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.anchor_milestone_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.project_milestones m
                     WHERE m.id = NEW.anchor_milestone_id AND m.project_id = NEW.project_id) THEN
    RAISE EXCEPTION 'anchor milestone % is not in project %', NEW.anchor_milestone_id, NEW.project_id;
  END IF;
  IF NEW.depends_on_milestone_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.project_milestones m
                     WHERE m.id = NEW.depends_on_milestone_id AND m.project_id = NEW.project_id) THEN
    RAISE EXCEPTION 'dependency milestone % is not in project %', NEW.depends_on_milestone_id, NEW.project_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS comms_items_same_project_trg ON public.comms_items;
CREATE TRIGGER comms_items_same_project_trg
  BEFORE INSERT OR UPDATE ON public.comms_items
  FOR EACH ROW EXECUTE FUNCTION public.comms_items_same_project();

-- ─────────────────────────────────────────────────────────────
-- 2. RLS — three tiers, matching audiences and training
-- ─────────────────────────────────────────────────────────────
ALTER TABLE public.comms_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins manage comms" ON public.comms_items;
CREATE POLICY "Admins manage comms" ON public.comms_items FOR ALL
  USING (public.is_admin()) WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "Client admins manage their comms" ON public.comms_items;
CREATE POLICY "Client admins manage their comms" ON public.comms_items FOR ALL
  USING      (public.is_client_admin() AND EXISTS (SELECT 1 FROM public.projects p WHERE p.id = comms_items.project_id AND p.client_id = public.my_client_id()))
  WITH CHECK (public.is_client_admin() AND EXISTS (SELECT 1 FROM public.projects p WHERE p.id = comms_items.project_id AND p.client_id = public.my_client_id()));

DROP POLICY IF EXISTS "Members read their comms" ON public.comms_items;
CREATE POLICY "Members read their comms" ON public.comms_items FOR SELECT
  USING (EXISTS (SELECT 1 FROM public.project_members m WHERE m.project_id = comms_items.project_id AND m.user_id = auth.uid()));

-- Table-level GRANT — separate from RLS. RLS decides which ROWS a role sees; this decides
-- whether the role may touch the table at all. Both gates must be open. Missing this
-- surfaced as "permission denied for table comms_items" in the running app while the SQL
-- editor (postgres superuser, bypasses grants) passed. Row visibility stays governed by
-- the three policies above.
GRANT SELECT, INSERT, UPDATE, DELETE ON public.comms_items TO authenticated;

-- ─────────────────────────────────────────────────────────────
-- 3. The schedule view — where the date and the status are derived
-- ─────────────────────────────────────────────────────────────
-- security_invoker = on so the BASE TABLE's RLS applies to whoever queries the view,
-- rather than the view owner's rights. (The older training/scope views predate this and
-- lean on the app always filtering by client — worth retrofitting the same flag there.)
DROP VIEW IF EXISTS public.comms_schedule;
CREATE VIEW public.comms_schedule
  WITH (security_invoker = on) AS
WITH anchored AS (
  SELECT
    ci.*,
    p.client_id,
    am.name AS anchor_name,
    -- A milestone is a point (milestone_date) or a band (starts_on..ends_on). An item
    -- anchored to a band tracks its END — the output completes when the band closes.
    coalesce(am.milestone_date, am.ends_on, am.starts_on) AS anchor_date,
    dm.name AS depends_name,
    coalesce(dm.milestone_date, dm.ends_on, dm.starts_on) AS depends_date
  FROM public.comms_items ci
  JOIN public.projects p ON p.id = ci.project_id
  LEFT JOIN public.project_milestones am ON am.id = ci.anchor_milestone_id
  LEFT JOIN public.project_milestones dm ON dm.id = ci.depends_on_milestone_id
)
SELECT
  a.id, a.project_id, a.client_id,
  a.message, a.audience, a.size, a.channel, a.owner_name,
  a.anchor_milestone_id, a.anchor_name, a.offset_days, a.fixed_date,
  a.override_date, a.depends_on_milestone_id, a.depends_name, a.depends_date,
  a.sent, a.sent_on, a.notes, a.sort_order,

  -- The date the anchor implies (milestone date + offset), or the fixed date.
  CASE WHEN a.anchor_milestone_id IS NOT NULL AND a.anchor_date IS NOT NULL
       THEN a.anchor_date + a.offset_days
       ELSE a.fixed_date END                                   AS derived_date,

  -- What the item is actually scheduled for: an override wins, else the derived date.
  coalesce(
    a.override_date,
    CASE WHEN a.anchor_milestone_id IS NOT NULL AND a.anchor_date IS NOT NULL
         THEN a.anchor_date + a.offset_days
         ELSE a.fixed_date END
  )                                                            AS effective_date,

  -- Detached: an override that no longer matches the anchor. The item has been revised
  -- away from its milestone and no longer moves with it — worth flagging, not hiding.
  (a.override_date IS NOT NULL
    AND a.anchor_milestone_id IS NOT NULL
    AND a.override_date <> (a.anchor_date + a.offset_days))     AS detached,

  -- The upstream output has happened if there is no dependency, or its date has passed.
  (a.depends_on_milestone_id IS NULL OR a.depends_date <= CURRENT_DATE) AS upstream_ready,

  -- The derived status. Order matters: sent first, then unschedulable, then future,
  -- then the blocked-vs-overdue distinction that is the whole point.
  CASE
    WHEN a.sent THEN 'sent'
    WHEN coalesce(a.override_date,
           CASE WHEN a.anchor_milestone_id IS NOT NULL AND a.anchor_date IS NOT NULL
                THEN a.anchor_date + a.offset_days ELSE a.fixed_date END) IS NULL
      THEN 'unscheduled'                                        -- anchor has no date yet
    WHEN coalesce(a.override_date,
           CASE WHEN a.anchor_milestone_id IS NOT NULL AND a.anchor_date IS NOT NULL
                THEN a.anchor_date + a.offset_days ELSE a.fixed_date END) > CURRENT_DATE
      THEN 'planned'
    WHEN (a.depends_on_milestone_id IS NOT NULL AND a.depends_date > CURRENT_DATE)
      THEN 'blocked'                                            -- past due, upstream not reached
    ELSE 'overdue'                                              -- past due, nothing blocking it
  END                                                          AS derived_status
FROM anchored a;

GRANT SELECT ON public.comms_schedule TO authenticated;

-- ─────────────────────────────────────────────────────────────
-- 4. Check
-- ─────────────────────────────────────────────────────────────
SELECT p.name AS project, cs.message, cs.audience,
       cs.effective_date, cs.derived_status,
       CASE WHEN cs.detached THEN 'revised — off anchor' ELSE cs.anchor_name END AS anchored_to
FROM public.comms_schedule cs
JOIN public.projects p ON p.id = cs.project_id
ORDER BY p.name, cs.effective_date NULLS LAST;
