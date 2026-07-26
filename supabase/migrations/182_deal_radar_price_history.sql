-- 182 — Deal Radar price-history verification ("is this a REAL deal?").
--
-- Keepa's edge over a raw deals page is the full price history. The refresh cron
-- enriches deals with a product-stats lookup (~1 token each, paced) and stores
-- the verdict here so the grid can badge a genuine discount vs a fake one (a %
-- off an inflated list price) — and so the generated post can state the truth
-- honestly ("lowest price we've seen; typically $X").
--
-- Nullable + verified-at timestamp: enrichment is best-effort and paced, so a
-- deal may be un-verified for a refresh cycle or two. price_verified_at lets the
-- cron re-check stale rows and the UI show "checking…" vs a real badge.
ALTER TABLE deal_radar_cache
  ADD COLUMN IF NOT EXISTS price_avg90_cents  integer,      -- typical (90-day avg)
  ADD COLUMN IF NOT EXISTS price_low_cents    integer,      -- all-time low Keepa has seen
  ADD COLUMN IF NOT EXISTS deal_quality       text,         -- excellent | genuine | fair | weak
  ADD COLUMN IF NOT EXISTS lowest_label       text,         -- "All-time low" / "32% below its usual price"
  ADD COLUMN IF NOT EXISTS price_verified_at  timestamptz;  -- when we last pulled stats

-- "Verified real deals" filter + surfacing the best-quality deals first.
CREATE INDEX IF NOT EXISTS deal_radar_quality_idx
  ON deal_radar_cache (deal_quality)
  WHERE deal_quality IS NOT NULL;
