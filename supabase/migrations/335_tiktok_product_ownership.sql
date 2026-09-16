-- 335_tiktok_product_ownership.sql
--
-- How the creator came by each TikTok Shop product, because two different
-- disclosures hang off it and the current one covers neither.
--
--   'bought'    they bought it. Full first-person review voice, no extra line.
--               This is the DEFAULT and the existing behaviour, so every row
--               already saved keeps publishing exactly as it does today.
--   'gifted'    the brand sent it. Same voice, plus the gifted disclosure the
--               FTC requires. "This post contains affiliate links" discloses a
--               commission and says nothing about the product being a gift.
--   'not-used'  they have not used it. The post keeps their voice but stops
--               claiming hands-on time (lib/deal-scrub already does this), and
--               says so. A disclaimer cannot repair a review of a product the
--               writer never handled; a different voice can.
--
-- Safe to run twice.

alter table public.tiktok_products
  add column if not exists ownership text not null default 'bought';

-- Anything unrecognised reads as 'bought' in the app, but the constraint keeps
-- the column honest so a typo fails at write time instead of quietly changing
-- a post's voice.
alter table public.tiktok_products
  drop constraint if exists tiktok_products_ownership_check;
alter table public.tiktok_products
  add constraint tiktok_products_ownership_check
  check (ownership in ('bought', 'gifted', 'not-used'));

comment on column public.tiktok_products.ownership is
  'bought | gifted | not-used. Drives the post voice and the extra disclosure. See lib/product-ownership.ts';
