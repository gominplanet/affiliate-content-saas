-- Migration 154: carousel-video PLACEMENT for SCOUT's deep import check
--
-- Supersedes the has_carousel_video boolean (mig 152) with WHERE the product's
-- carousel video sits, which the creator cares about:
--   • 'top'    — the video is in the hero image gallery (#altImages). The
--                high-value placement: it shows in the product's main media.
--   • 'bottom' — video only in the lower "Videos for this product" / related-
--                videos carousel.
--   • 'none'   — no carousel video on the product page.
-- SCOUT now imports ALL of the creator's hand-picked products (no silent drops)
-- and records this so the /epc list shows top / bottom / none per row. The old
-- boolean is kept and backfilled (top|bottom -> true, none -> false) so legacy
-- rows and quick-Accept imports still render.

alter table public.campaigns
  add column if not exists carousel_video_pos text
  check (carousel_video_pos in ('top', 'bottom', 'none'));

-- Backfill the new column from the existing boolean where we already have it.
update public.campaigns
  set carousel_video_pos = case when has_carousel_video then 'top' else 'none' end
  where carousel_video_pos is null and has_carousel_video is not null;
