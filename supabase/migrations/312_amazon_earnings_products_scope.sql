-- 312 — Add the columns 311 left off amazon_earnings_products.
--
-- 311 gave the period totals a store_scope (onsite / offsite) and a quantity, and
-- forgot both on the product table. The ingest route writes them for products the
-- same way it does for periods, so every product write failed on "column
-- amazon_earnings_products.store_scope does not exist" and no per-product row was
-- ever stored. The reads failed on the same column.
--
-- Scope matters here for exactly the reason it matters on the totals: Amazon
-- reports the same product separately for the storefront (onamz… ids) and for
-- traffic sent in from outside, and collapsing the two hides which half of a
-- product's earnings came from work the creator can repeat.

alter table public.amazon_earnings_products
  add column if not exists store_scope text,
  add column if not exists quantity    integer;

comment on column public.amazon_earnings_products.store_scope is
  'onsite = storefront and shoppable videos (onamz… ids); offsite = traffic sent in from YouTube, a blog or socials. Null when Amazon did not say.';

notify pgrst, 'reload schema';
