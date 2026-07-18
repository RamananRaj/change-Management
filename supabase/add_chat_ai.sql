-- ChangeFlow · CFM — UJL (in-chat AI). Marks a message as an AI reply so the UI renders it as
-- UJL. The row is still inserted by the requesting member (RLS unchanged). Safe to re-run.

ALTER TABLE public.chat_messages ADD COLUMN IF NOT EXISTS is_ai boolean NOT NULL DEFAULT false;

SELECT 'chat_messages.is_ai ready (UJL)' AS result;
