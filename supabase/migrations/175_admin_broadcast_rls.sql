-- 175_admin_broadcast_rls.sql
-- SECURITY FIX (guarded): migration 167 creates admin_broadcasts +
-- admin_broadcast_events but never enables Row-Level Security. Those tables hold
-- admin-only data — broadcast subjects/counts and per-recipient EMAIL + open/
-- click/bounce events. With RLS off they'd inherit Supabase's default
-- anon/authenticated grants, so any logged-in user could read them via PostgREST.
--
-- The intended design is service-role only (the broadcast + Resend webhook
-- routes use the service-role client, which BYPASSES RLS). Enabling RLS with NO
-- policies gives clients deny-all — the lockdown ai_usage / announcements /
-- stripe_webhook_events already use.
--
-- Guarded with to_regclass so this is a safe no-op if the tables don't exist yet
-- (migration 167 hasn't been applied to this database — the admin-broadcast
-- feature isn't live). Run 167 + this together whenever that feature ships.
DO $$
BEGIN
  IF to_regclass('public.admin_broadcasts') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE public.admin_broadcasts ENABLE ROW LEVEL SECURITY';
  END IF;
  IF to_regclass('public.admin_broadcast_events') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE public.admin_broadcast_events ENABLE ROW LEVEL SECURITY';
  END IF;
END $$;
