-- 186 — Price Watch + Price Alerts (Keepa-powered).
--
-- Phase 1 of the Keepa content-trigger loop. A creator "watches" a product
-- (explicitly, or automatically when they turn a deal into a blog post). A paced
-- cron re-checks each watched ASIN's live price against its history and emits an
-- alert when something worth acting on happens:
--   • new_low     — the product hit a genuine new all-time low → nudge a
--                   "price just dropped" social re-share of content they made.
--   • stale_price — the price drifted far from what a published post claims →
--                   the post should be refreshed (accuracy + Amazon ToS).
--
-- Prices in CENTS (integers) so comparisons never touch floats.

CREATE TABLE IF NOT EXISTS product_watches (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id              uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  asin                 text NOT NULL,
  -- Why this product is watched. 'deal_post' rows also carry blog_post_id so a
  -- stale-price alert can link straight to the post to refresh.
  source               text NOT NULL DEFAULT 'manual',   -- manual | deal_post
  blog_post_id         uuid,                              -- set for deal_post source

  title                text,
  image_url            text,

  -- Baseline the post/watch was created at — a stale_price alert fires when the
  -- live price drifts far from this.
  baseline_price_cents integer,
  -- Rolling state the cron maintains.
  last_price_cents     integer,
  -- Lowest price we've ALREADY alerted on, so a flat all-time-low doesn't
  -- re-alert every run — only a fresh, lower low does.
  last_alerted_low_cents integer,
  last_checked_at      timestamptz,

  created_at           timestamptz NOT NULL DEFAULT now(),

  UNIQUE (user_id, asin)
);

-- The cron picks the least-recently-checked watches first (round-robins coverage
-- under the token budget).
CREATE INDEX IF NOT EXISTS product_watches_check_idx
  ON product_watches (last_checked_at ASC NULLS FIRST);
CREATE INDEX IF NOT EXISTS product_watches_user_idx ON product_watches (user_id);

ALTER TABLE product_watches ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "product_watches_own" ON product_watches;
CREATE POLICY "product_watches_own" ON product_watches
  FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());
-- (the cron writes via the service role, which bypasses RLS)

CREATE TABLE IF NOT EXISTS price_alerts (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  asin           text NOT NULL,
  kind           text NOT NULL,                 -- new_low | stale_price
  title          text,
  image_url      text,
  price_now_cents integer,
  -- For new_low: the all-time low. For stale_price: the post's baseline price.
  price_ref_cents integer,
  label          text,                          -- human one-liner for the UI
  blog_post_id   uuid,                          -- stale_price → the post to refresh
  seen           boolean NOT NULL DEFAULT false,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS price_alerts_feed_idx ON price_alerts (user_id, created_at DESC);
-- Bell badge: unseen alerts per user (tiny partial index).
CREATE INDEX IF NOT EXISTS price_alerts_unseen_idx ON price_alerts (user_id) WHERE seen = false;

ALTER TABLE price_alerts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "price_alerts_own_read" ON price_alerts;
CREATE POLICY "price_alerts_own_read" ON price_alerts
  FOR SELECT TO authenticated USING (user_id = auth.uid());
-- Users may mark their own alerts seen; inserts are service-role only (the cron).
DROP POLICY IF EXISTS "price_alerts_own_update" ON price_alerts;
CREATE POLICY "price_alerts_own_update" ON price_alerts
  FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
