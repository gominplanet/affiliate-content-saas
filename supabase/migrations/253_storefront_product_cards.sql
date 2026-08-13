-- 253 — Storefront product-card cache (Keepa garnish for AMZ Storefront).
--
-- The AMZ Storefront dashboard (/storefront) shows SCOUT-synced earnings per
-- product. To garnish each row with a catalogue snapshot (image, price, ~monthly
-- demand, rating, discount) we call Keepa — but a creator's storefront ASINs are
-- usually NOT in deal_radar_cache (that's the global Deal Radar feed, and writing
-- non-deal products there would pollute everyone's Deal Radar). So this is a
-- SEPARATE global product-card cache: one row per ASIN, service-role written,
-- read by any signed-in user. Product facts are the same for everyone, so it's
-- global (not per-user) and one Keepa lookup benefits all.
--
-- Prices in CENTS (integers) to match deal_radar_cache.
CREATE TABLE IF NOT EXISTS storefront_product_cards (
  asin             text PRIMARY KEY,
  title            text,
  image_url        text,
  price_now_cents  integer,
  price_was_cents  integer,
  discount_pct     integer,       -- 1–99
  rating           numeric,       -- 0–5
  review_count     integer,
  monthly_sold     integer,
  refreshed_at     timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE storefront_product_cards ENABLE ROW LEVEL SECURITY;

-- Any signed-in user may READ the shared cards (product facts are not private).
-- Writes go through the service-role admin client only (which bypasses RLS), so
-- there is deliberately no INSERT/UPDATE policy for regular users.
DROP POLICY IF EXISTS "storefront_product_cards read" ON storefront_product_cards;
CREATE POLICY "storefront_product_cards read"
  ON storefront_product_cards FOR SELECT
  TO authenticated
  USING (true);
