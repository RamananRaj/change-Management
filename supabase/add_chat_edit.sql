-- ChangeFlow · let people fix their own chat messages.
-- Typos are the main reason; editing is limited to your OWN messages, and edits are visible
-- (edited_at drives an "edited" marker) so the record stays honest. Safe to re-run.

ALTER TABLE public.chat_messages ADD COLUMN IF NOT EXISTS edited_at timestamptz;

-- You may edit only your own message, and may not reassign it to someone else.
DROP POLICY IF EXISTS "Senders edit own messages" ON public.chat_messages;
CREATE POLICY "Senders edit own messages" ON public.chat_messages
  FOR UPDATE USING (sender_id = auth.uid()) WITH CHECK (sender_id = auth.uid());

GRANT UPDATE ON public.chat_messages TO authenticated;

SELECT 'chat message editing enabled' AS result;
