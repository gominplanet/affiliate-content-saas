-- 334_tiktok_products.sql
--
-- TikTok Shop products a creator has added, one at a time, from the product
-- link they already have. There is no catalogue scan and there cannot be: a
-- TikTok showcase is an in-app mini program with no web page for a server or a
-- browser extension to read. An individual product page, by contrast, is a
-- normal server-rendered site, so the catalogue is built by pasting.
--
-- share_url IS THE CREATOR'S MONEY. The link they paste carries _t / u_code and
-- the rest of TikTok's share attribution, and that is what credits the sale to
-- them. It is stored verbatim and published verbatim. canonical_url is only
-- ever for re-reading the product data; nothing user-facing may link to it.
--
-- Safe to run twice.

create table if not exists public.tiktok_products (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references auth.users(id) on delete cascade,
  -- TikTok's own product id, parsed from the URL. Unique per creator so the
  -- same product added twice updates rather than duplicating.
  product_id       text not null,
  -- The creator's pasted link, EXACTLY as pasted. Never normalized.
  share_url        text not null,
  -- The clean /pdp/<id> URL, for re-reading the page only.
  canonical_url    text,
  title            text not null,
  description      text,
  image_url        text,
  -- Text, not numeric: this is a display price with no history behind it, and
  -- storing it as money would invite the Amazon price-claim paths to treat it
  -- like one. There is no "lowest we have seen" for a TikTok product.
  price            text,
  currency         text,
  currency_symbol  text,
  rating           numeric(3,2),
  review_count     integer,
  sold_count       integer,
  seller_name      text,
  region           text,
  created_at       timestamptz not null default now(),
  refreshed_at     timestamptz not null default now()
);

alter table public.tiktok_products
  add column if not exists canonical_url   text,
  add column if not exists description     text,
  add column if not exists image_url       text,
  add column if not exists price           text,
  add column if not exists currency        text,
  add column if not exists currency_symbol text,
  add column if not exists rating          numeric(3,2),
  add column if not exists review_count    integer,
  add column if not exists sold_count      integer,
  add column if not exists seller_name     text,
  add column if not exists region          text,
  add column if not exists refreshed_at    timestamptz not null default now();

create unique index if not exists tiktok_products_user_product_idx
  on public.tiktok_products (user_id, product_id);
create index if not exists tiktok_products_user_added_idx
  on public.tiktok_products (user_id, created_at desc);

alter table public.tiktok_products enable row level security;

drop policy if exists tiktok_products_select_own on public.tiktok_products;
create policy tiktok_products_select_own on public.tiktok_products
  for select using (auth.uid() = user_id);

drop policy if exists tiktok_products_insert_own on public.tiktok_products;
create policy tiktok_products_insert_own on public.tiktok_products
  for insert with check (auth.uid() = user_id);

drop policy if exists tiktok_products_update_own on public.tiktok_products;
create policy tiktok_products_update_own on public.tiktok_products
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists tiktok_products_delete_own on public.tiktok_products;
create policy tiktok_products_delete_own on public.tiktok_products
  for delete using (auth.uid() = user_id);
