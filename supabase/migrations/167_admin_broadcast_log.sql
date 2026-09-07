-- 167 — Send-history log for the admin broadcast tool (/admin/broadcast).
--
-- admin_broadcasts        one row per blast (subject, audience, send counts)
-- admin_broadcast_events  one row per recipient per event TYPE, so opens/clicks
--                         dedupe to UNIQUE counts automatically via the PK.
--
-- Populated by /api/admin/broadcast at send-time and by the Resend webhook
-- (/api/newsletter/resend-webhook) as delivery/open/click/bounce events arrive.
-- Service-role only (admin surfaces), which is why there are no policies: the
-- service role bypasses RLS, so with RLS on and nothing granted, these tables are
-- reachable by the admin routes and by nobody else.
--
-- RLS IS THE THING THAT MAKES THAT TRUE. "Service-role only" was written here as
-- if it were a property of the code, but a table sitting in the public schema is
-- served by PostgREST to anyone holding the anon key unless RLS says otherwise,
-- and these rows are every broadcast subject and every recipient's email
-- address. The enable statements below are the whole protection.

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

-- No policies on purpose: the admin routes use the service-role client, which
-- bypasses RLS. Every other key gets nothing.
alter table admin_broadcasts        enable row level security;
alter table admin_broadcast_events  enable row level security;
