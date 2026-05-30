-- ChangeFlow: Link templates to phase_content items
-- Adds an optional template_id FK so a content item (exercise/tool) can have
-- an embedded interactive table that users fill in from their drawer.

ALTER TABLE public.phase_content
  ADD COLUMN IF NOT EXISTS template_id uuid REFERENCES public.templates(id) ON DELETE SET NULL;

-- ---
-- Seed: Change Readiness Assessment template (Phase 1)
-- Standard ADKAR-aligned readiness columns used in change programmes.
-- ---
INSERT INTO public.templates (
  title,
  description,
  phase_number,
  columns,
  sort_order,
  is_active
)
VALUES (
  'Change Readiness Assessment',
  'Assess readiness across key areas of your organisation to identify gaps, barriers and priority actions before the change begins.',
  1,
  '[
    {"key":"area",              "label":"Area / Department",    "type":"text",    "required":true},
    {"key":"change_element",    "label":"Change Element",       "type":"select",  "required":false, "options":["People","Process","Technology","Culture"]},
    {"key":"awareness",         "label":"Awareness",            "type":"rating",  "required":false},
    {"key":"desire",            "label":"Desire to Change",     "type":"rating",  "required":false},
    {"key":"knowledge",         "label":"Knowledge & Skills",   "type":"rating",  "required":false},
    {"key":"leadership_support","label":"Leadership Support",   "type":"rating",  "required":false},
    {"key":"key_barriers",      "label":"Key Barriers",         "type":"text",    "required":false},
    {"key":"recommended_actions","label":"Recommended Actions", "type":"text",    "required":false},
    {"key":"owner",             "label":"Owner",                "type":"text",    "required":false},
    {"key":"due_date",          "label":"Due Date",             "type":"date",    "required":false},
    {"key":"rag_status",        "label":"RAG Status",           "type":"select",  "required":false, "options":["Green","Amber","Red"]}
  ]'::jsonb,
  10,
  true
);

SELECT 'template_id column added and Change Readiness Assessment template seeded' AS result;
