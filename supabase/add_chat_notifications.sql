-- ChangeFlow · chat notifications (email + web push), admin-configurable.
-- A pg_cron job pings the notify-chat Edge Function on a short cadence; the function finds each
-- user's unread qualifying messages and delivers via the enabled channels, throttled per user by
-- the admin's cadence setting. Safe to re-run.

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- ── Admin-facing settings (readable by app so it knows if push is offered) ─────────
CREATE TABLE IF NOT EXISTS public.notification_config (
  id             boolean PRIMARY KEY DEFAULT true CHECK (id),
  trigger        text NOT NULL DEFAULT 'mentions'  CHECK (trigger IN ('off','mentions','all')),
  cadence        text NOT NULL DEFAULT 'digest'    CHECK (cadence IN ('immediate','digest')),
  digest_minutes int  NOT NULL DEFAULT 15,
  email_enabled  boolean NOT NULL DEFAULT true,
  push_enabled   boolean NOT NULL DEFAULT true,
  vapid_public   text,                         -- Web Push public key (safe to expose to the browser)
  updated_at     timestamptz DEFAULT now()
);
-- If the table already existed, make sure the column is present.
ALTER TABLE public.notification_config ADD COLUMN IF NOT EXISTS vapid_public text;
INSERT INTO public.notification_config (id) VALUES (true) ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.notification_config ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "read notif config"  ON public.notification_config;
CREATE POLICY "read notif config"  ON public.notification_config FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "admin write notif config" ON public.notification_config;
CREATE POLICY "admin write notif config" ON public.notification_config FOR UPDATE USING (public.is_admin()) WITH CHECK (public.is_admin());
GRANT SELECT, UPDATE ON public.notification_config TO authenticated;

-- ── Per-user Web Push subscriptions ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.push_subscriptions (
  id         uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id    uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  endpoint   text NOT NULL,
  p256dh     text NOT NULL,
  auth       text NOT NULL,
  created_at timestamptz DEFAULT now(),
  UNIQUE (endpoint)
);
CREATE INDEX IF NOT EXISTS push_sub_user_idx ON public.push_subscriptions (user_id);
ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "own push subs" ON public.push_subscriptions;
CREATE POLICY "own push subs" ON public.push_subscriptions
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
GRANT SELECT, INSERT, DELETE ON public.push_subscriptions TO authenticated;
GRANT SELECT ON public.push_subscriptions TO service_role;   -- the function reads all to send

-- ── Per-user notification throttle state (last time we notified them) ───────────────
CREATE TABLE IF NOT EXISTS public.notification_state (
  user_id         uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  last_notified_at timestamptz DEFAULT now()
);
ALTER TABLE public.notification_state ENABLE ROW LEVEL SECURITY;   -- service-role only (no policies)
GRANT SELECT, INSERT, UPDATE ON public.notification_state TO service_role;

-- ── Private cron config (function URL + secret) — never exposed to the browser ──────
CREATE TABLE IF NOT EXISTS public.notify_cron_config (
  id     boolean PRIMARY KEY DEFAULT true CHECK (id),
  url    text,
  secret text
);
ALTER TABLE public.notify_cron_config ENABLE ROW LEVEL SECURITY;   -- no policies = no API access

-- Master-Admin: turn the delivery cron on/off. p_minutes NULL/0 = off. Runs the notify-chat
-- function; the function itself throttles per user by the cadence setting.
CREATE OR REPLACE FUNCTION public.set_notify_schedule(p_minutes int)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_url text; v_secret text; v_cron text; v_cmd text;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'not authorized'; END IF;
  SELECT url, secret INTO v_url, v_secret FROM public.notify_cron_config WHERE id;
  IF v_url IS NULL OR v_secret IS NULL THEN RAISE EXCEPTION 'notify_cron_config not set — insert URL + secret first'; END IF;
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'changeflow-chat-notify') THEN PERFORM cron.unschedule('changeflow-chat-notify'); END IF;
  IF p_minutes IS NULL OR p_minutes <= 0 THEN RETURN 'notify schedule disabled'; END IF;
  v_cron := CASE WHEN p_minutes < 60 THEN '*/' || p_minutes || ' * * * *'
                 WHEN p_minutes % 60 = 0 AND p_minutes < 1440 THEN '0 */' || (p_minutes/60) || ' * * *'
                 ELSE '0 3 * * *' END;
  v_cmd := format($f$SELECT net.http_post(url := %L,
             headers := jsonb_build_object('Content-Type','application/json','x-cron-secret', %L),
             body := jsonb_build_object('source','scheduled'));$f$, v_url, v_secret);
  PERFORM cron.schedule('changeflow-chat-notify', v_cron, v_cmd);
  RETURN 'notify scheduled: ' || v_cron;
END $$;
GRANT EXECUTE ON FUNCTION public.set_notify_schedule(int) TO authenticated;

SELECT 'chat notifications schema + RPC created' AS result;
