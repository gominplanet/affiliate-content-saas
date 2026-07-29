-- 197 — CC catalog: representative-product signals for the "Browse all" view.
--
-- The Browse view (slice 1) shows campaign economics (commission, budget,
-- slots, days left). This adds the PRODUCT signals CreatorKit shows too —
-- image, recent sales, rating, video count, price/discount — for the campaign's
-- representative product (its first ASIN).
--
-- Populated CHEAPLY by a paced cron (enrich-cc-catalog) off the shared operator
-- Keepa key, exactly like Deal Radar: cost scales with distinct products ×
-- cadence, NOT with user count. Columns are NOT written by the catalog import,
-- so they survive re-imports (upsert only touches the campaign columns).
--
-- rep_asin is a STORED generated column (asins[1] — Postgres arrays are
-- 1-indexed) so the cron can index/filter/update every campaign that shares a
-- representative product in one pass.
ALTER TABLE cc_campaign_catalog
  ADD COLUMN IF NOT EXISTS rep_asin text GENERATED ALWAYS AS (asins[1]) STORED,
  ADD COLUMN IF NOT EXISTS image_url text,
  ADD COLUMN IF NOT EXISTS price_now_cents integer,
  ADD COLUMN IF NOT EXISTS price_was_cents integer,
  ADD COLUMN IF NOT EXISTS discount_pct integer,
  ADD COLUMN IF NOT EXISTS rating numeric,
  ADD COLUMN IF NOT EXISTS review_count integer,
  ADD COLUMN IF NOT EXISTS monthly_sold integer,
  ADD COLUMN IF NOT EXISTS video_count integer,
  ADD COLUMN IF NOT EXISTS product_verified_at timestamptz;

-- The cron updates every campaign sharing a representative product by rep_asin.
CREATE INDEX IF NOT EXISTS cc_catalog_rep_asin_idx ON cc_campaign_catalog (rep_asin);
-- Sort/filter paths for the Browse view.
CREATE INDEX IF NOT EXISTS cc_catalog_monthly_sold_idx ON cc_campaign_catalog (monthly_sold DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS cc_catalog_rating_idx ON cc_campaign_catalog (rating DESC NULLS LAST);
-- Least-recently-verified first, so the cron works through the catalog evenly.
CREATE INDEX IF NOT EXISTS cc_catalog_verify_idx ON cc_campaign_catalog (product_verified_at ASC NULLS FIRST);

NOTIFY pgrst, 'reload schema';
