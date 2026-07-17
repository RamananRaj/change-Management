-- ChangeFlow · change_artifacts — one generic, versioned store for captured insights
-- (heat maps, stakeholder maps, impact summaries, …). New artifact kinds need NO new table
-- and NO migration: they're just a new `type` string + a JSON shape in `data`. The AI ingests
-- them (attach → extract → confirm) and rules retrieve them. Scoped per client by RLS.
-- Uses public.is_admin() / public.is_client_admin() / public.my_client_id(). Safe to re-run.

CREATE TABLE IF NOT EXISTS public.change_artifacts (
  id          uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id   uuid REFERENCES public.clients(id) ON DELETE CASCADE,
  project_id  uuid,                         -- optional: scope to a project/release
  type        text NOT NULL,                -- 'stakeholder_heatmap' | 'change_impact' | 'stakeholder_map' | ...
  title       text NOT NULL,
  version     int  DEFAULT 1,
  is_current  boolean DEFAULT true,
  data        jsonb NOT NULL DEFAULT '{}',  -- the structured payload (shape depends on type)
  source      text,                         -- where it was captured from (file name, etc.)
  created_at  timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS change_artifacts_lookup_idx ON public.change_artifacts (client_id, type, is_current);

ALTER TABLE public.change_artifacts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Read change artifacts" ON public.change_artifacts;
CREATE POLICY "Read change artifacts" ON public.change_artifacts
  FOR SELECT USING (public.is_admin() OR client_id = public.my_client_id());

DROP POLICY IF EXISTS "Manage change artifacts" ON public.change_artifacts;
CREATE POLICY "Manage change artifacts" ON public.change_artifacts
  FOR ALL
  USING (public.is_admin() OR (public.is_client_admin() AND client_id = public.my_client_id()))
  WITH CHECK (public.is_admin() OR (public.is_client_admin() AND client_id = public.my_client_id()));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.change_artifacts TO authenticated;

-- ── Seed: a stakeholder impact heat map for Horizon Power (so the AI call works now) ──
INSERT INTO public.change_artifacts (client_id, type, title, version, is_current, source, data)
SELECT c.id, 'stakeholder_heatmap', 'Stakeholder impact heat map', 1, true, 'seed',
  '{
    "cols": ["People","Process","Information","Technology"],
    "rows": [
      {"label":"Asset Planning & Delivery","cells":["h","m","h","m"]},
      {"label":"Customer & Community","cells":["m","m","l","l"]},
      {"label":"Finance","cells":["m","m","m","m"]},
      {"label":"Operations","cells":["h","h","m","h"]},
      {"label":"People & Safety","cells":["m","l","l","m"]},
      {"label":"Information & Technology","cells":["h","m","h","vh"]}
    ],
    "commentary": "**Operations** and **Information & Technology** carry the highest stakeholder impact. Technology peaks for the I&T group (system migration); Operations is High across People, Process and Technology. Customer & Community is the lightest touch."
  }'::jsonb
FROM public.clients c
WHERE c.name = 'Horizon Power'
  AND NOT EXISTS (SELECT 1 FROM public.change_artifacts a WHERE a.client_id = c.id AND a.type = 'stakeholder_heatmap');

SELECT 'change_artifacts table created (+ Horizon Power seed)' AS result;
