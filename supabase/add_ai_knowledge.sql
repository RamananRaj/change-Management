-- ChangeFlow · CORA knowledge rules (data, not code).
--
-- Discipline guidance ("how do we do comms / training / cutover / train-the-trainer") lives HERE,
-- not in the application source. CORA serves the rule instantly; if none exists it falls back to
-- the on-device model and writes the answer back as a draft rule, so the next ask is instant and
-- the library gets richer over time.
--
-- Bodies may contain tokens CORA fills from live data:
--   {{client}} {{scope}} {{projects}} {{audiences}} {{owners}} {{milestones}} {{groupcount}}
--   {{phase1}} {{phase2}} {{phase3}} {{phase4}} {{phase5}}   (planned start dates)
--
-- Resolution order: client-specific → industry → global. Safe to re-run.

CREATE TABLE IF NOT EXISTS public.ai_knowledge (
  id          uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  topic       text NOT NULL,                       -- 'comms' | 'training' | 'cutover' | 'ttt' | …
  client_id   uuid REFERENCES public.clients(id) ON DELETE CASCADE,   -- NULL = not client-specific
  industry    text,                                -- NULL = any industry
  title       text,
  body        text NOT NULL,
  source      text NOT NULL DEFAULT 'curated' CHECK (source IN ('seed','curated','slm')),
  status      text NOT NULL DEFAULT 'active' CHECK (status IN ('active','draft')),
  version     int  NOT NULL DEFAULT 1,
  created_by  uuid,
  created_at  timestamptz DEFAULT now(),
  updated_at  timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ai_knowledge_topic_idx ON public.ai_knowledge (topic, client_id, industry);

ALTER TABLE public.ai_knowledge ENABLE ROW LEVEL SECURITY;

-- Everyone signed in may READ the guidance (it's practice, not client data).
DROP POLICY IF EXISTS "read ai knowledge" ON public.ai_knowledge;
CREATE POLICY "read ai knowledge" ON public.ai_knowledge FOR SELECT TO authenticated USING (true);

-- Only Master Admins curate — including the SLM write-back, which happens under an admin session.
DROP POLICY IF EXISTS "admins write ai knowledge" ON public.ai_knowledge;
CREATE POLICY "admins write ai knowledge" ON public.ai_knowledge
  FOR ALL USING (public.is_admin()) WITH CHECK (public.is_admin());

GRANT SELECT, INSERT, UPDATE, DELETE ON public.ai_knowledge TO authenticated;
GRANT SELECT, INSERT ON public.ai_knowledge TO service_role;

-- ── Seed the four disciplines (global, editable — this replaces hardcoded prose) ──
-- Seeded with DELETE + INSERT..VALUES rather than INSERT..SELECT: Postgres has a
-- `SELECT .. INTO <table>` form, and linters that don't respect string literals misread the word
-- "into" in prose as a table creation. Plain VALUES avoids the ambiguity entirely.
--
-- IDEMPOTENCY NOTE: re-running this resets the four GLOBAL seed rows to these defaults. Rows you
-- have curated (source = 'curated'), model drafts (source = 'slm') and any client- or
-- industry-specific rules are untouched. If you edit a seed row and want to keep it, change its
-- source to 'curated' first.
DELETE FROM public.ai_knowledge
 WHERE source = 'seed' AND client_id IS NULL AND industry IS NULL;

INSERT INTO public.ai_knowledge (topic, title, body, source, status)
VALUES
  ('comms', 'Communications Approach', E'**1. Audiences (by impact)**\n{{audiences}}. Prioritise the highest-impact groups, they need the most frequent, most senior communication.\n\n**2. Objectives by phase**\n- Diagnose ({{phase1}}) - build awareness: why the change, why now.\n- Design ({{phase2}}) - involve: bring impacted groups in early to shape the solution.\n- Engage ({{phase3}}) - build readiness: what changes for me, and when.\n- Embed ({{phase4}}) - reinforce: support, answer questions, celebrate early wins.\n- Evaluate ({{phase5}}) - sustain: share outcomes and lock in new ways of working.\n\n**3. Channels**\nExecutive sponsor message for direction, line-manager briefing packs for the highest-impact groups (people trust their own manager most), intranet or Teams for reach, drop-in sessions for two-way dialogue, a maintained FAQ.\n\n**4. Cadence**\nFortnightly through Diagnose and Design, weekly through Engage and go-live, monthly through Embed. Increase frequency around milestones.\n\n**5. Owners**\n{{owners}}. Name a single accountable comms owner per audience.\n\n**6. Anchor moments**\n{{milestones}}.\n\n**7. How you will know it is working**\nReadiness survey scores by group, session attendance, the volume and theme of questions, and manager confidence.', 'seed', 'active'),
  ('training', 'Training Approach', E'**1. Audiences (by impact)**\n{{audiences}}. Training depth should follow impact - highest-impact groups get role-specific, hands-on training, lower-impact groups need awareness only.\n\n**2. Training needs analysis**\nFor each impacted group define: what they do today, what changes, and the specific capability gap. Do this before designing content - it is what makes training role-relevant rather than a system demo.\n\n**3. Delivery approach**\nBlended: e-learning for awareness and basics, instructor-led or floor-walking for high-impact roles, quick-reference guides for day-one support. Use real scenarios from their actual work.\n\n**4. Schedule**\nDesign and build during Design ({{phase2}}), deliver through Engage ({{phase3}}) close enough to go-live to be retained but with time to practise, reinforce during Embed ({{phase4}}).\n\n**5. Owners**\n{{owners}}.\n\n**6. Key dates**\n{{milestones}}.\n\n**7. Measures**\nCompletion rates, post-training confidence, readiness survey movement, and - the real test - support-ticket volume after go-live.', 'seed', 'active'),
  ('cutover', 'Cutover Approach', E'**1. Scope**\n{{projects}}. Impacted groups: {{audiences}}.\n\n**2. Readiness gates**\nBefore cutover confirm: training complete for high-impact roles, readiness at or above target, support model staffed, and Embed prerequisites closed.\n\n**3. Cutover window**\nAnchored on Embed ({{phase4}}) and Evaluate ({{phase5}}). Key dates: {{milestones}}.\n\n**4. Sequence**\nFreeze, then final data migration and validation, technical switch, smoke checks, business verification by named users from each impacted group, go/no-go, announce live.\n\n**5. Go/no-go**\nNamed decision-makers, agreed criteria, a rollback plan and a decision deadline. Decide in advance what a no looks like.\n\n**6. Hypercare**\nElevated support for the first two weeks: floor-walkers for the highest-impact groups, daily triage, a visible route for issues. Taper deliberately.\n\n**7. Owners**\n{{owners}}.', 'seed', 'active'),
  ('ttt', 'Train-the-Trainer Approach', E'**1. Why train-the-trainer here**\nWith impacted groups spanning {{groupcount}} areas, cascading through local trainers scales further and lands better - people learn best from someone who knows their actual job.\n\n**2. Trainer selection**\nPick from the highest-impact groups first ({{audiences}}). Choose credibility over availability: respected practitioners others already ask for help.\n\n**3. Candidate pool**\n{{owners}}.\n\n**4. Prepare the trainers**\nDeeper functional training than end-users, plus facilitation skills, the reasoning behind the change so they can handle challenge, and a full trainer pack (slides, scenarios, FAQ, objections).\n\n**5. Certification**\nEach trainer delivers a practice session observed by the core team before going live. This is the step most programmes skip and most regret.\n\n**6. Cascade schedule**\nTrain trainers during Design ({{phase2}}), they deliver through Engage ({{phase3}}), reinforce in Embed ({{phase4}}). Key dates: {{milestones}}.\n\n**7. Support the trainers**\nA private channel for questions, weekly check-ins during the cascade, refreshed materials when things change, and visible recognition - this sits on top of their day job.', 'seed', 'active');

SELECT 'ai_knowledge created + seeded' AS result;
