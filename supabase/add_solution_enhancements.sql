-- ChangeFlow · Solution Enhancement board (replaces the old admin page-notes/comments).
-- A private product backlog visible ONLY to a fixed email allowlist — even other Master Admins
-- can't see it. Enforced in RLS via the JWT email claim. Safe to re-run.

CREATE TABLE IF NOT EXISTS public.solution_enhancements (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title           text NOT NULL,
  detail          text,
  status          text NOT NULL DEFAULT 'idea',  -- idea | planned | in_progress | done
  created_by      uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_by_name text,
  created_at      timestamptz DEFAULT now(),
  updated_at      timestamptz DEFAULT now()
);

ALTER TABLE public.solution_enhancements ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Enhancement allowlist" ON public.solution_enhancements;
CREATE POLICY "Enhancement allowlist" ON public.solution_enhancements
  FOR ALL TO authenticated
  USING      (lower(auth.jwt() ->> 'email') IN ('bedi.ujjwal@gmail.com', 'ram.raj@ramraj.com.au'))
  WITH CHECK (lower(auth.jwt() ->> 'email') IN ('bedi.ujjwal@gmail.com', 'ram.raj@ramraj.com.au'));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.solution_enhancements TO authenticated;

SELECT 'solution_enhancements ready (allowlisted)' AS result;
