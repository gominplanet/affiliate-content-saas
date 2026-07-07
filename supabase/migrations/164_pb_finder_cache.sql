-- ── 164: PartnerBoost Finder catalog cache (per-user) ──────────────────────
-- The PartnerBoost MVP Finder sweeps a creator's JOINED brands one product-call
-- per brand — 1000+ brands = 1000+ live calls, ~2 min. This table caches a
-- user's swept products so the Finder can read them back INSTANTLY and filter by
-- Focus/Wide/keyword without re-hammering the API. Populated by the background
-- sync (/api/partnerboost/sync). Per-user (PB tracking links are per-publisher),
-- RLS owner-only. Rows carry a precomputed score + avoided flag so reads are a
-- simple ordered/filtered SELECT.

CREATE TABLE IF NOT EXISTS pb_finder_cache (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  product_key        text NOT NULL,          -- sku, else the product URL
  name               text,
  price              numeric,
  commission_pct     numeric,
  flat_payout        numeric,
  per_sale           numeric,                -- est. commission $ per sale
  score              numeric,                -- precomputed rank key
  avoided            boolean NOT NULL DEFAULT false, -- hits a hard-NO category
  image_url          text,
  url                text,
  category           text,
  brand_name         text,
  network            text,                   -- Walmart / Amazon / DTC
  sku                text,
  tracking_url       text,                   -- product's own deep-link
  brand_tracking_url text,                   -- brand deep-link base
  synced_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, product_key)
);

-- Finder reads: this user's non-avoided rows, ordered by score.
CREATE INDEX IF NOT EXISTS pb_finder_cache_user_score_idx
  ON pb_finder_cache (user_id, avoided, score DESC);

ALTER TABLE pb_finder_cache ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "pb_finder_cache_own" ON pb_finder_cache;
CREATE POLICY "pb_finder_cache_own" ON pb_finder_cache
  FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());
