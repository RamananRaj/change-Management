-- Re-run add_training.sql then add_training_coverage.sql to pick up the view change,
-- then restore the seeded value that the editor overwrote.
UPDATE public.training_needs n SET applies_to = 30
FROM public.training_modules m, public.audiences a
WHERE m.id = n.module_id AND a.id = n.audience_id
  AND m.name = 'Refund Processing' AND a.name = 'Billing Operations';
