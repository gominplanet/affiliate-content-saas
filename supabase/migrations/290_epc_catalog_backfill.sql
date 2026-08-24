-- 290 — one-time backfill: seed the shared EPC catalog from existing libraries.
--
-- Migration 289 starts populating epc_catalog on every NEW scan. This backfills
-- it from the products already sitting in per-user epc_products so the shared
-- "All EPC products" view is full immediately instead of waiting for re-scans.
--
-- One representative row per ASIN across ALL creators: the highest-EPC sighting
-- (so the reference "up to $X" is the best offer any creator saw), most-recent as
-- the tie-break. Merges with anything already in the catalog (greatest EPC wins,
-- blanks filled). Safe to re-run — it's an idempotent upsert.

insert into public.epc_catalog (
  asin, title, brand, image_url, price_cents, rating, epc_value_ref, budget_ref, first_seen_at, last_seen_at
)
select distinct on (asin)
  asin,
  title,
  brand,
  image_url,
  price_cents,
  rating,
  epc_value,
  budget,
  coalesce(first_seen_at, now()),
  coalesce(scanned_at, now())
from public.epc_products
where asin is not null and asin ~ '^[A-Z0-9]{10}$'
order by asin, epc_value desc nulls last, scanned_at desc
on conflict (asin) do update set
  title         = coalesce(public.epc_catalog.title, excluded.title),
  brand         = coalesce(public.epc_catalog.brand, excluded.brand),
  image_url     = coalesce(public.epc_catalog.image_url, excluded.image_url),
  price_cents   = coalesce(public.epc_catalog.price_cents, excluded.price_cents),
  rating        = coalesce(public.epc_catalog.rating, excluded.rating),
  epc_value_ref = greatest(coalesce(public.epc_catalog.epc_value_ref, 0), coalesce(excluded.epc_value_ref, 0)),
  budget_ref    = coalesce(public.epc_catalog.budget_ref, excluded.budget_ref),
  last_seen_at  = greatest(public.epc_catalog.last_seen_at, excluded.last_seen_at);

notify pgrst, 'reload schema';
