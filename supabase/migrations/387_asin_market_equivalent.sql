-- 387: the same product under another Amazon country's ASIN, remembered.
--
-- Liftoff now checks every country before it shows the country cards. A
-- product Amazon does not sell under its US ASIN in, say, Germany is looked
-- for again there by barcode, then by brand and model or name, and the answer
-- (the German ASIN, or "none") is a fact about the product, not about one
-- creator. This keeps it so the next page load, and every other creator with
-- the same product, does not pay Keepa for it again.
--
-- local_asin NULL means everything was tried and nothing matched.
-- Service-role only, like passport_asin_market (294): RLS on, no policy.
--
-- Safe to run more than once.
create table if not exists public.asin_market_equivalent (
  source_asin text not null,
  domain      text not null,        -- amazon.de
  local_asin  text,                 -- null: no listing there is this product
  how         text,                 -- 'barcode' | 'model' | 'name' | null
  checked_at  timestamptz not null default now(),
  primary key (source_asin, domain)
);
alter table public.asin_market_equivalent enable row level security;
notify pgrst, 'reload schema';
