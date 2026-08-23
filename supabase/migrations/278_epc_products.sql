-- 278 — EPC / Sponsored Products research library.
--
-- Amazon's "Creator Connections Check" → Sponsored Products view shows per-creator
-- EPC (estimated earnings-per-click) opportunities: product, price, rating,
-- "Estimated EPC: Up to $X", and a "Budget availability score" (Low/Medium/High).
-- There's no CSV export for it, so SCOUT scrapes the open tab (MVP_CC_SCAN →
-- scoutCreatorConnections) and the app saves each row here. This is a GROWING,
-- per-user library: re-scanning upserts on (user_id, asin), refreshing the
-- numbers + scanned_at while keeping first_seen_at, so a creator builds a
-- searchable EPC library over time instead of only seeing the latest scan.

create table if not exists public.epc_products (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references auth.users(id) on delete cascade,
  asin           text not null,
  title          text,
  brand          text,
  image_url      text,
  price_cents    int,             -- parsed price, cents (null if unreadable)
  epc_value      numeric,         -- estimated EPC in dollars, e.g. 0.24
  epc_display    text,            -- the raw label, e.g. "Up to $0.24"
  budget         text,            -- Low | Medium | High (budget availability score)
  rating         numeric,         -- star rating, e.g. 4.4
  ends_at        date,            -- campaign end date if shown
  details_url    text,            -- the Amazon opportunity/details link
  first_seen_at  timestamptz not null default now(),
  scanned_at     timestamptz not null default now(),
  unique (user_id, asin)
);

-- A creator's library, most-recently-scanned first.
create index if not exists epc_products_user_scanned_idx
  on public.epc_products (user_id, scanned_at desc);
-- Sort by EPC (the headline signal).
create index if not exists epc_products_user_epc_idx
  on public.epc_products (user_id, epc_value desc nulls last);

alter table public.epc_products enable row level security;

-- Creators see and manage only their own EPC library. The ingest route uses the
-- user's session client, so these RLS policies apply directly.
drop policy if exists epc_products_select_own on public.epc_products;
create policy epc_products_select_own on public.epc_products
  for select using (auth.uid() = user_id);

drop policy if exists epc_products_insert_own on public.epc_products;
create policy epc_products_insert_own on public.epc_products
  for insert with check (auth.uid() = user_id);

drop policy if exists epc_products_update_own on public.epc_products;
create policy epc_products_update_own on public.epc_products
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists epc_products_delete_own on public.epc_products;
create policy epc_products_delete_own on public.epc_products
  for delete using (auth.uid() = user_id);

notify pgrst, 'reload schema';
