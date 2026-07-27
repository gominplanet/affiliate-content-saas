-- 185 — Deal Radar: store Amazon's "X+ bought in the past month" figure.
--
-- Keepa returns monthlySold as a top-level field on the SAME /product response
-- the cron already fetches for price-history verification, so capturing it costs
-- zero extra tokens. It's the lower bound of Amazon's "bought in past month"
-- badge (e.g. 500 = "500+ bought"). NULL = Amazon shows no badge for this
-- product (most of them) — treat as "unknown", never as "zero sales".
ALTER TABLE deal_radar_cache
  ADD COLUMN IF NOT EXISTS monthly_sold integer;
