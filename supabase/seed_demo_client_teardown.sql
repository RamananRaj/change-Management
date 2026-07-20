-- ChangeFlow · remove the demo client and everything it seeded.
--
-- Deleting the client cascades to its project, phases, lanes, milestones,
-- pathway, members, client-scoped content and templates.
--
-- Two things do NOT cascade, because those tables are global rather than
-- client-scoped, so they are removed explicitly:
--   • stakeholders  (rows prefixed 'Meridian ·')
--   • surveys       (titled 'Meridian Demo ·', cascades to its questions)
--
-- user_activities rows referencing the deleted content cascade away with it.

DELETE FROM public.surveys      WHERE title LIKE 'Meridian Demo ·%';
DELETE FROM public.stakeholders WHERE name  LIKE 'Meridian ·%';
DELETE FROM public.clients      WHERE name = 'Meridian Water Corporation (Demo)';

SELECT 'demo client removed' AS result;
