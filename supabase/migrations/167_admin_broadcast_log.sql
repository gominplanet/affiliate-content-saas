-- 167 — Send-history log for the admin broadcast tool (/admin/broadcast).
--
-- admin_broadcasts        one row per blast (subject, audience, send counts)
-- admin_broadcast_events  one row per recipient per event TYPE, so opens/clicks
--                         dedupe to UNIQUE counts automatically via the PK.
--
-- Populated by /api/admin/broadcast at send-time and by the Resend webhook
-- (/api/newsletter/resend-webhook) as delivery/open/click/bounce events arrive.
-- Service-role only (admin surfaces) — no RLS policies needed; the table is
-- never exposed to the anon/auth client.

CREATE TABLE IF NOT EXISTS admin_broadcasts (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at  timestamptz NOT NULL DEFAULT now(),
  created_by  uuid,
  subject     text NOT NULL,
  audience    text NOT NULL,
  total       integer NOT NULL DEFAULT 0,   -- recipients attempted
  sent        integer NOT NULL DEFAULT 0,   -- Resend accepted
  failed      integer NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS admin_broadcast_events (
  broadcast_id uuid NOT NULL REFERENCES admin_broadcasts(id) ON DELETE CASCADE,
  email        text NOT NULL,
  event_type   text NOT NULL,               -- delivered | opened | clicked | bounced | complained
  created_at   timestamptz NOT NULL DEFAULT now(),
  -- One row per (blast, recipient, type): a recipient opening twice is still
  -- one 'opened' row, so COUNT(*) is a true unique-open number.
  PRIMARY KEY (broadcast_id, email, event_type)
);

CREATE INDEX IF NOT EXISTS idx_admin_broadcast_events_bid
  ON admin_broadcast_events (broadcast_id);
