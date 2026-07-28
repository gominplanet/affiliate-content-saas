-- 196 — Deal Radar: reconcile discount_pct with price-history reality.
--
-- BUG: the "15%+ off" filter reads discount_pct, but the Keepa Deal-endpoint
-- delta stored there is frequently NULL even for genuinely discounted items —
-- the card instead shows the price-history verdict ("54% below its usual
-- price"). NULL fails `>= 15`, so real, clearly-discounted deals were filtered
-- OUT of the feed.
--
-- FIX: discount_pct now carries the LARGER of (Keepa delta, price-history
-- discount = current price vs 90-day average), so the number the UI filters,
-- sorts, and badges on matches what the card actually shows. The refresh cron
-- maintains this going forward (enrichPriceHistory); this one-time backfill
-- fixes the rows already sitting in the cache.
--
-- Idempotent (GREATEST + the > guard) — safe to re-run.
UPDATE deal_radar_cache
SET discount_pct = LEAST(99, GREATEST(
  COALESCE(discount_pct, 0),
  FLOOR(((price_avg90_cents - price_now_cents)::numeric / price_avg90_cents) * 100)::int
))
WHERE price_avg90_cents IS NOT NULL AND price_avg90_cents > 0
  AND price_now_cents  IS NOT NULL AND price_now_cents < price_avg90_cents
  AND FLOOR(((price_avg90_cents - price_now_cents)::numeric / price_avg90_cents) * 100)::int
      > COALESCE(discount_pct, 0);

NOTIFY pgrst, 'reload schema';
