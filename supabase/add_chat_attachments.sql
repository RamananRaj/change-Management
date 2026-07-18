-- ChangeFlow · CFM attachments (MVP). Private bucket, per-channel Storage RLS, and a message
-- column to carry the file metadata. Files live at path "<channel_id>/<uuid>-<filename>".
-- Only channel members can upload/read; Master Admin can read (oversight). Safe to re-run.

-- Message metadata: { path, name, type, size }
ALTER TABLE public.chat_messages ADD COLUMN IF NOT EXISTS attachment jsonb;

-- Private bucket.
INSERT INTO storage.buckets (id, name, public)
VALUES ('chat-attachments', 'chat-attachments', false)
ON CONFLICT (id) DO NOTHING;

-- Read: channel members + Master Admin. The channel id is the first path segment.
DROP POLICY IF EXISTS "chat attach read" ON storage.objects;
CREATE POLICY "chat attach read" ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'chat-attachments'
  AND (public.is_admin() OR public.is_channel_member(((storage.foldername(name))[1])::uuid, auth.uid()))
);

-- Upload: only members of that channel.
DROP POLICY IF EXISTS "chat attach upload" ON storage.objects;
CREATE POLICY "chat attach upload" ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'chat-attachments'
  AND public.is_channel_member(((storage.foldername(name))[1])::uuid, auth.uid())
);

-- Delete your own uploads (or admin).
DROP POLICY IF EXISTS "chat attach delete" ON storage.objects;
CREATE POLICY "chat attach delete" ON storage.objects FOR DELETE TO authenticated
USING (
  bucket_id = 'chat-attachments'
  AND (public.is_admin() OR owner = auth.uid())
);

SELECT 'chat attachments ready' AS result;
