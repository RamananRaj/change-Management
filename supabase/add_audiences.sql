-- ChangeFlow: audiences — the groups a change lands on.
--
-- STEP 1 of the training needs analysis build, and a prerequisite for three other
-- things that are currently blocked on it:
--   • comms  — an item can name who it goes to, and how many, instead of free text
--   • gates  — readiness is scored per business unit rather than per typed-in string
--   • impact — the heat map rows become data rather than a hand-authored artifact
--
-- Deliberately small. Name, size, impact and an owner. No membership table: a group
-- is a headcount and a person who speaks for it, which is all the first release needs.
--
-- Safe to re-run.

CREATE TABLE IF NOT EXISTS public.audiences (
  id           uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id   uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  name         text NOT NULL,

  -- Optional roll-up (Operations → Billing Operations). One level is enough to report
  -- against; deeper hierarchies are org charts, which this is not.
  parent_id    uuid REFERENCES public.audiences(id) ON DELETE SET NULL,

  -- NULL = nobody has established the size, and that must stay distinguishable from
  -- zero. A zero makes every coverage percentage that divides by it silently wrong,
  -- and "0 of 0 trained" renders as complete — the same failure as marking an
  -- unassessed gate unit green.
  headcount    int CHECK (headcount IS NULL OR headcount >= 0),

  impact_level text CHECK (impact_level IN ('vh','h','m','l','vl','none')),

  -- The people-leader who speaks for this group. This is the person the fortnightly
  -- training check will be sent to, so it is not merely descriptive.
  owner_id     uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  owner_name   text,          -- for a leader who has no ChangeFlow account

  notes        text,
  sort_order   int DEFAULT 0,
  created_at   timestamptz DEFAULT now(),
  updated_at   timestamptz DEFAULT now(),
  UNIQUE (project_id, name)
);

CREATE INDEX IF NOT EXISTS idx_audiences_project ON public.audiences(project_id, sort_order);

-- One level of nesting only, for the same reason as the timeline lanes: unbounded
-- depth has no meaning in a report and makes every roll-up recursive.
CREATE OR REPLACE FUNCTION public.audience_depth_ok() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE grandparent uuid;
BEGIN
  IF NEW.parent_id IS NOT NULL THEN
    IF NEW.parent_id = NEW.id THEN
      RAISE EXCEPTION 'an audience cannot be its own parent';
    END IF;
    SELECT parent_id INTO grandparent FROM public.audiences WHERE id = NEW.parent_id;
    IF grandparent IS NOT NULL THEN
      RAISE EXCEPTION 'audiences nest one level only: % already has a parent', NEW.parent_id;
    END IF;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_audience_depth ON public.audiences;
CREATE TRIGGER trg_audience_depth BEFORE INSERT OR UPDATE ON public.audiences
  FOR EACH ROW EXECUTE FUNCTION public.audience_depth_ok();

-- ─────────────────────────────────────────────────────────────
-- RLS
-- ─────────────────────────────────────────────────────────────
ALTER TABLE public.audiences ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins manage audiences" ON public.audiences;
CREATE POLICY "Admins manage audiences" ON public.audiences FOR ALL
  USING (public.is_admin()) WITH CHECK (public.is_admin());

-- Client admins run their own programmes; Master Admin should not be a bottleneck
-- for routine setup.
DROP POLICY IF EXISTS "Client admins manage their audiences" ON public.audiences;
CREATE POLICY "Client admins manage their audiences" ON public.audiences FOR ALL
  USING      (public.is_client_admin() AND EXISTS (SELECT 1 FROM public.projects p WHERE p.id = audiences.project_id AND p.client_id = public.my_client_id()))
  WITH CHECK (public.is_client_admin() AND EXISTS (SELECT 1 FROM public.projects p WHERE p.id = audiences.project_id AND p.client_id = public.my_client_id()));

DROP POLICY IF EXISTS "Members read their project audiences" ON public.audiences;
CREATE POLICY "Members read their project audiences" ON public.audiences FOR SELECT
  USING (EXISTS (SELECT 1 FROM public.project_members m WHERE m.project_id = audiences.project_id AND m.user_id = auth.uid()));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.audiences TO authenticated;

-- ─────────────────────────────────────────────────────────────
-- Seed the demo client so there is something to look at
-- ─────────────────────────────────────────────────────────────
-- Field Services is deliberately left with an unknown headcount and no owner: a demo
-- where every row is complete never shows how the unknown case renders.
DO $$
DECLARE v_project uuid;
BEGIN
  SELECT p.id INTO v_project
  FROM public.projects p JOIN public.clients c ON c.id = p.client_id
  WHERE c.name = 'Meridian Water Corporation (Demo)' LIMIT 1;

  IF v_project IS NULL THEN
    RAISE NOTICE 'Meridian demo project not found — skipping seed. Tables are still created.';
    RETURN;
  END IF;

  INSERT INTO public.audiences (project_id, name, headcount, impact_level, owner_name, notes, sort_order) VALUES
    (v_project, 'Billing Operations',       180,  'vh', 'D. Okafor',    'Role, process and system all change together.', 0),
    (v_project, 'Contact Centre',           140,  'h',  'S. Whitcombe', 'New scripts and a single customer view.', 1),
    (v_project, 'Field Services',           NULL, 'm',  NULL,           'Headcount not yet confirmed by the depot leads.', 2),
    (v_project, 'Finance',                  45,   'l',  'A. Nguyen',    'Month-end process changes only.', 3),
    (v_project, 'Information & Technology', 25,   'l',  NULL,           'Builds the change rather than absorbing it.', 4)
  ON CONFLICT (project_id, name) DO NOTHING;
END $$;

SELECT name,
       COALESCE(headcount::text, 'unknown') AS headcount,
       COALESCE(impact_level, '—')          AS impact,
       COALESCE(owner_name, 'unassigned')   AS owner
FROM public.audiences
WHERE project_id = (SELECT p.id FROM public.projects p JOIN public.clients c ON c.id = p.client_id
                    WHERE c.name = 'Meridian Water Corporation (Demo)' LIMIT 1)
ORDER BY sort_order;
