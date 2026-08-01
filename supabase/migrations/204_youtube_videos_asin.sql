-- 204 — Persist the product ASIN per video.
--
-- WHY: most creators use a Geniuslink (geni.us) as their product link, which
-- HIDES the ASIN behind a short link. The "CC campaign" badge (and any future
-- ASIN-keyed lookup) needs the ASIN. MVP already knows it at generation time
-- (it built the geni.us from an amazon /dp/<ASIN>), so we now store it here. For
-- older posts, the badge endpoint resolves the short link ONCE and caches the
-- result in this column, so it never re-resolves.

ALTER TABLE public.youtube_videos
  ADD COLUMN IF NOT EXISTS asin text;

CREATE INDEX IF NOT EXISTS youtube_videos_asin_idx
  ON public.youtube_videos (asin)
  WHERE asin IS NOT NULL;

COMMENT ON COLUMN public.youtube_videos.asin IS
  'Resolved product ASIN for this video (written at blog generation; backfilled by resolving geni.us/amzn.to short links). Powers the CC-campaign badge.';
