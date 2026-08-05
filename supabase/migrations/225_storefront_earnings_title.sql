-- 225 — carry the Amazon-reported product title on earnings rows.
--
-- The Influencer earnings report is keyed by product title (ASIN comes from the
-- product link). Storing the title gives Storefront Stats a real name to show
-- for products that have sales but aren't in the Keepa deal cache or tied to MVP
-- content yet — otherwise they'd render as a bare ASIN.
alter table public.storefront_earnings
  add column if not exists product_title text;
