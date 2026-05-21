-- 052 — Persist the resolved product URL on the video
--
-- During blog generation we resolve the product (ASIN from the title,
-- the description's Amazon link, or discovery) and build an affiliate
-- URL. We now store that URL so the dashboard can show a clickable
-- "Visit product" link — letting the creator confirm the AI resolved
-- the RIGHT product (which also drives the in-body image rendering).
--
-- Plain Amazon /dp/{asin} (with the user's Associates tag when set) or
-- the Geniuslink wrap created during discovery. Nullable — general /
-- non-product videos have none.

alter table public.youtube_videos
  add column if not exists product_url text;
