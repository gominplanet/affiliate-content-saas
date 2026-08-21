-- 271 — Mark which storefront products the creator has a video for.
--
-- On Amazon Creator Hub each shoppable video is tied to a product ASIN (the
-- video table loads per-ASIN). SCOUT reads that table and flags the matching
-- catalog rows here, so the storefront can show "you have a video for this /
-- you don't" — the real video↔product map, straight from the creator's own
-- Creator Hub. Idempotent.

alter table public.storefront_catalog
  add column if not exists has_video boolean not null default false;

notify pgrst, 'reload schema';
