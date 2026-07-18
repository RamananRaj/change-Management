-- ChangeFlow · phrase learning — teach the AI that your wording maps to a known action.
-- e.g. "teach: monthly wrap-up = report" then "give me the monthly wrap-up for Horizon Power"
-- routes to the change report. Platform-wide (all users benefit); Master Admin governs writes.

CREATE TABLE IF NOT EXISTS public.ai_intent_phrases (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phrase      text NOT NULL,                 -- what the user typed
  phrase_norm text NOT NULL UNIQUE,          -- normalised (lowercased, punctuation-stripped)
  intent      text NOT NULL,                 -- a known rules intent (report, at_risk, …)
  created_by  uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at  timestamptz DEFAULT now()
);

ALTER TABLE public.ai_intent_phrases ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Read intent phrases" ON public.ai_intent_phrases;
CREATE POLICY "Read intent phrases" ON public.ai_intent_phrases
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Admins manage intent phrases" ON public.ai_intent_phrases;
CREATE POLICY "Admins manage intent phrases" ON public.ai_intent_phrases
  FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());
