-- 289 — shared cross-user EPC catalog ("Discover all EPC products").
--
-- The per-user EPC library (epc_products) is personal: Amazon shows each creator
-- their OWN accepted Sponsored Products, with a per-creator EPC estimate. But the
-- POOL of products overlaps heavily across creators, and Amazon's EPC estimate for
-- a product is driven by that product's performance, so it's similar across
-- creators. This table is the deduped, product-level union of everyone's scans —
-- a discovery pool any signed-in creator can browse without scanning thousands
-- themselves. The EPC here is a REFERENCE value (the most recent one seen), shown
-- and labeled as such; a creator still accepts the campaign on Amazon to earn.
--
-- Populated (service-role) from every scan's ingest. Keepa signals (rank / price /
-- deal) are NOT duplicated here — the catalog list joins keepa_product_cache
-- (migration 288) by ASIN, so there's one source for that data.

create table if not exists public.epc_catalog (
  asin           text primary key,
  title          text,
  brand          text,
  image_url      text,
  price_cents    int,       -- last-seen scraped price
  rating         numeric,
  epc_value_ref  numeric,   -- reference estimated EPC (most recent seen)
  budget_ref     text,      -- reference budget score
  first_seen_at  timestamptz not null default now(),
  last_seen_at   timestamptz not null default now()
);
create index if not exists epc_catalog_epc_idx on public.epc_catalog (epc_value_ref desc nulls last);
create index if not exists epc_catalog_price_idx on public.epc_catalog (price_cents asc nulls last);
create index if not exists epc_catalog_rating_idx on public.epc_catalog (rating desc nulls last);
create index if not exists epc_catalog_seen_idx on public.epc_catalog (last_seen_at desc);

-- Any signed-in user may BROWSE the shared catalog. Writes go through the
-- service-role (admin) client only — no insert/update/delete policy on purpose.
alter table public.epc_catalog enable row level security;
drop policy if exists epc_catalog_read on public.epc_catalog;
create policy epc_catalog_read on public.epc_catalog
  for select using (auth.uid() is not null);

notify pgrst, 'reload schema';
