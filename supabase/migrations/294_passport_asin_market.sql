-- 294 — Passport Links: per-marketplace product-availability cache.
--
-- Passport geo-routes a click to the visitor's local Amazon store using the SAME
-- ASIN. But an Amazon ASIN often isn't listed in every marketplace (e.g. a US
-- product that doesn't exist on amazon.ca), so the visitor hit a dead 404 page.
-- The redirect now verifies the product exists in the target store and, if it
-- doesn't, falls back to the US store where the source ASIN lives. This table
-- caches that check per (asin, marketplace) so the redirect stays fast after the
-- first lookup.

create table if not exists public.passport_asin_market (
  asin        text not null,
  marketplace text not null,        -- amazon host, e.g. www.amazon.ca
  available   boolean not null,     -- is the ASIN a real product on that host?
  checked_at  timestamptz not null default now(),
  primary key (asin, marketplace)
);

-- Service-role only (the public redirect reads/writes it with the admin client);
-- RLS on with no policy denies all anon/auth access.
alter table public.passport_asin_market enable row level security;

notify pgrst, 'reload schema';
