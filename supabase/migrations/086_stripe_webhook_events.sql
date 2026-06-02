-- Stripe webhook idempotency
--
-- Background: tonight's 2026-06-02 audit flagged that the Stripe webhook
-- route has no event-id dedup. Stripe retries every webhook on 5xx, and
-- the dashboard lets you replay manually. Without dedup, a replayed
-- `customer.subscription.deleted` (or any other event) could cause
-- duplicate downgrades, double-charges, or out-of-order tier flips.
--
-- Fix: a tiny table that records every event.id we've successfully
-- processed. The webhook checks this BEFORE doing any work — if the
-- event_id is already there, return 200 immediately and skip.
--
-- Why a regular table and not just an upsert + check: an UPSERT
-- doesn't tell us "was this row new?" without a RETURNING clause, and
-- it'd race with concurrent retries (Stripe sometimes fires the same
-- webhook to multiple endpoints simultaneously during a brief network
-- partition). With INSERT ... ON CONFLICT DO NOTHING + a RETURNING
-- check, we get atomic "did we win the race?" semantics.
--
-- Retention: 30 days. Stripe's webhook retry window is up to 3 days
-- for any single event, so 30 covers replays + manual dashboard
-- replays comfortably. A simple cleanup query (left for ops to run
-- via cron when needed) drops rows older than 30 days.

CREATE TABLE IF NOT EXISTS stripe_webhook_events (
  -- Stripe's event id (evt_xxxxxxxxxxxxxxxxxxxxxxxx). Primary key
  -- gives us the dedup gate for free + the natural index on lookups.
  event_id    text PRIMARY KEY,

  -- Event type for telemetry / debugging (customer.subscription.deleted,
  -- checkout.session.completed, etc). Indexed for quick "show me all
  -- replayed deletes" queries during incident review.
  event_type  text NOT NULL,

  -- When we recorded the event. Used for the 30-day cleanup sweep.
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_stripe_webhook_events_created_at
  ON stripe_webhook_events (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_stripe_webhook_events_event_type
  ON stripe_webhook_events (event_type);

-- RLS: the table is only ever touched by the service-role webhook
-- route. Enable RLS with no policies so RLS-scoped client reads return
-- empty (safest default if anyone accidentally exposes it later).
ALTER TABLE stripe_webhook_events ENABLE ROW LEVEL SECURITY;

-- Optional cleanup (run via cron when convenient — not auto-scheduled):
--   DELETE FROM stripe_webhook_events WHERE created_at < now() - interval '30 days';
