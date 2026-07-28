-- 195 — Deal Radar: "has a product-carousel video" flag.
--
-- Some Amazon listings carry a brand/merchant video in the image carousel — a
-- strong conversion signal AND ready-made b-roll a creator can lift into a
-- Short/Reel. This flags those so the feed can offer a "Has video" filter.
--
-- Populated CHEAPLY: the refresh cron already calls Keepa's /product endpoint
-- once per ASIN during price-history verification. We piggyback on that exact
-- call (add the `videos` field to it — cached metadata, no extra `offers`
-- request), so this costs ~no additional Keepa tokens. Coverage therefore fills
-- in gradually across runs, same cadence as the price verdicts.
--
-- TRI-STATE on purpose:
--   true   → we confirmed an image-carousel (brand/merchant) video
--   false  → we checked and there is none
--   NULL   → not yet checked (unknown) — the filter shows only confirmed `true`
ALTER TABLE deal_radar_cache
  ADD COLUMN IF NOT EXISTS has_video boolean;

-- Partial index: the "Has video" filter only ever queries `has_video = true`, so
-- index just those rows (tiny, and skips the NULL/false majority).
CREATE INDEX IF NOT EXISTS deal_radar_has_video_idx
  ON deal_radar_cache (has_video) WHERE has_video;

NOTIFY pgrst, 'reload schema';
