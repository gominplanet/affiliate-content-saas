-- 175_admin_broadcast_rls.sql
-- SECURITY FIX: migration 167 created admin_broadcasts + admin_broadcast_events
-- but never enabled Row-Level Security. They hold admin-only data — broadcast
-- subjects/audience/counts and, worse, per-recipient EMAIL + open/click/bounce
-- events. With RLS off they inherit Supabase's default anon/authenticated
-- grants, so any logged-in user could read them straight off PostgREST
-- (GET /rest/v1/admin_broadcast_events?select=*).
--
-- Intended design: service-role only (the admin broadcast + Resend webhook
-- routes use the service-role client, which BYPASSES RLS). Enabling RLS with
-- NO policies gives clients deny-all — the exact lockdown ai_usage /
-- announcements / stripe_webhook_events already use. No app code changes.
ALTER TABLE public.admin_broadcasts       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_broadcast_events ENABLE ROW LEVEL SECURITY;
