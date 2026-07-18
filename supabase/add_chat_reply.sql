-- ChangeFlow · CFM — reply to a specific message (WhatsApp-style quoted replies).
-- Adds a self-reference on chat_messages; the app renders the quoted snippet. Safe to re-run.

ALTER TABLE public.chat_messages
  ADD COLUMN IF NOT EXISTS reply_to uuid REFERENCES public.chat_messages(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS chat_messages_reply_idx ON public.chat_messages (reply_to);

SELECT 'chat_messages.reply_to ready' AS result;
