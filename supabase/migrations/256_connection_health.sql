-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 256 — Proactive connection health for Facebook + YouTube
--
-- The dead-channel alert (lib/channel-health) is REACTIVE: it only lights up
-- after a platform fails N scheduled posts in a row. But Facebook page tokens
-- and YouTube OAuth tokens die SILENTLY — Meta/Google invalidate them on a
-- password change, a permissions reset, or inactivity — and MVP's UI keeps a
-- false green because it only checks "is a token stored", not "does it work".
-- A creator can sit disconnected for weeks, watch nothing publish, and cancel
-- (real ticket) before any scheduled-post streak ever trips the alert.
--
-- This stores the result of an ACTIVE token probe (Graph ping for FB, refresh
-- attempt for YT) so we can flag a dead connection the moment it dies, not after
-- it has already cost the creator posts. Shape:
--   connection_health = {
--     "facebook": { "ok": false, "dead": true, "reason": "...", "checkedAt": 173... },
--     "youtube":  { "ok": true,  "dead": false, "checkedAt": 173... }
--   }
-- connection_health_at is the last time ANY probe ran, so the lazy dashboard
-- path and the daily cron can both skip re-probing a freshly-checked row.
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.integrations
  add column if not exists connection_health jsonb,
  add column if not exists connection_health_at timestamptz;
