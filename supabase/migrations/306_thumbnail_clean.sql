-- 306_thumbnail_clean.sql
-- A text-free thumbnail variant for non-English storefronts.
--
-- The branded thumbnail bakes an English hook into the image (e.g. "WAIT THESE
-- 150HRS"), which is wrong to show a French or German shopper. Rather than change
-- the English thumbnail, we generate a second, clean version with no words on it
-- and cache its URL here. Storefront Sync then delivers the clean image to
-- non-English markets and the original (with text) to the English ones. Null
-- until a sync to a non-English market first needs it.
--
--   thumbnail_clean_url   hosted PNG of the branded thumbnail with no overlay text

alter table public.youtube_videos
  add column if not exists thumbnail_clean_url text;

notify pgrst, 'reload schema';
