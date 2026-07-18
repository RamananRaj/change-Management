-- ChangeFlow · CFM (Change Flow Messages) — chat schema, RLS and realtime.
-- Scoped per client. Members see channels they belong to; Master Admin (is_admin) reads ALL
-- for oversight but can only POST where they're a member. Uses is_admin() / my_client_id().
-- Safe to re-run.

CREATE TABLE IF NOT EXISTS public.chat_channels (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id   uuid REFERENCES public.clients(id) ON DELETE CASCADE,
  type        text NOT NULL DEFAULT 'dm',      -- 'dm' | 'group'
  name        text,                            -- group name (DMs derive name from the other member)
  created_by  uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at  timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.chat_members (
  channel_id   uuid REFERENCES public.chat_channels(id) ON DELETE CASCADE,
  user_id      uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  added_at     timestamptz DEFAULT now(),
  last_read_at timestamptz DEFAULT now(),
  PRIMARY KEY (channel_id, user_id)
);

CREATE TABLE IF NOT EXISTS public.chat_messages (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_id  uuid REFERENCES public.chat_channels(id) ON DELETE CASCADE,
  sender_id   uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  body        text NOT NULL,
  created_at  timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS chat_members_user_idx   ON public.chat_members (user_id);
CREATE INDEX IF NOT EXISTS chat_messages_chan_idx  ON public.chat_messages (channel_id, created_at);
CREATE INDEX IF NOT EXISTS chat_channels_client_idx ON public.chat_channels (client_id);

-- SECURITY DEFINER membership check (avoids RLS recursion when policies reference chat_members).
CREATE OR REPLACE FUNCTION public.is_channel_member(cid uuid, uid uuid)
RETURNS boolean LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.chat_members m WHERE m.channel_id = cid AND m.user_id = uid);
$$;

ALTER TABLE public.chat_channels ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_members  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_messages ENABLE ROW LEVEL SECURITY;

-- Channels: members + Master Admin can read; a user creates channels in their own client
-- (Master Admin can create in any).
DROP POLICY IF EXISTS "Read channels" ON public.chat_channels;
CREATE POLICY "Read channels" ON public.chat_channels FOR SELECT TO authenticated
  USING (public.is_admin() OR public.is_channel_member(id, auth.uid()));
DROP POLICY IF EXISTS "Create channels" ON public.chat_channels;
CREATE POLICY "Create channels" ON public.chat_channels FOR INSERT TO authenticated
  WITH CHECK (created_by = auth.uid() AND (public.is_admin() OR client_id = public.my_client_id()));
DROP POLICY IF EXISTS "Delete own channels" ON public.chat_channels;
CREATE POLICY "Delete own channels" ON public.chat_channels FOR DELETE TO authenticated
  USING (public.is_admin() OR created_by = auth.uid());

-- Members: readable by channel members + Master Admin. You can add yourself, and existing
-- members (or Master Admin) can add others. You can update your own row (last_read_at) / leave.
DROP POLICY IF EXISTS "Read members" ON public.chat_members;
CREATE POLICY "Read members" ON public.chat_members FOR SELECT TO authenticated
  USING (public.is_admin() OR public.is_channel_member(channel_id, auth.uid()));
DROP POLICY IF EXISTS "Add members" ON public.chat_members;
CREATE POLICY "Add members" ON public.chat_members FOR INSERT TO authenticated
  WITH CHECK (public.is_admin() OR user_id = auth.uid() OR public.is_channel_member(channel_id, auth.uid()));
DROP POLICY IF EXISTS "Update own membership" ON public.chat_members;
CREATE POLICY "Update own membership" ON public.chat_members FOR UPDATE TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
DROP POLICY IF EXISTS "Leave channel" ON public.chat_members;
CREATE POLICY "Leave channel" ON public.chat_members FOR DELETE TO authenticated
  USING (public.is_admin() OR user_id = auth.uid());

-- Messages: read if member or Master Admin (oversight); post only where you're a member
-- (so Master Admin can read everything but only speak in their own conversations).
DROP POLICY IF EXISTS "Read messages" ON public.chat_messages;
CREATE POLICY "Read messages" ON public.chat_messages FOR SELECT TO authenticated
  USING (public.is_admin() OR public.is_channel_member(channel_id, auth.uid()));
DROP POLICY IF EXISTS "Send messages" ON public.chat_messages;
CREATE POLICY "Send messages" ON public.chat_messages FOR INSERT TO authenticated
  WITH CHECK (sender_id = auth.uid() AND public.is_channel_member(channel_id, auth.uid()));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.chat_channels, public.chat_members, public.chat_messages TO authenticated;

-- Live delivery.
ALTER PUBLICATION supabase_realtime ADD TABLE public.chat_messages;

SELECT 'CFM chat schema ready' AS result;
