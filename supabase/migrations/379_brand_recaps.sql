-- Migration 379: Brand recap, one message per brand with every link the
-- creator published for its products.
--
-- product_post_links: the public link of a social post, kept at the moment the
-- post goes out, with the product it was about. Deal Radar, Encore and the
-- Amazon social pushes all get a live URL back from each platform and used to
-- keep none of them (on_sale_shares keeps only which platforms worked), so a
-- brand could never be shown those posts. From this migration on they are
-- kept. Older posts cannot be recovered.
--
-- brand_recaps: every recap sent, with the exact links in it, so the next one
-- can offer only what is new, and so a brand never gets the same links twice
-- by accident. ok is what actually happened: true when Amazon confirmed the
-- Creator Connections message, or when the creator marked a copied or emailed
-- recap as sent; false with error when it did not go.
--
-- Safe to run twice.

create table if not exists public.product_post_links (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  asin        text not null,
  platform    text not null,
  url         text not null,
  source      text,
  created_at  timestamptz not null default now(),
  unique (user_id, url)
);
create index if not exists product_post_links_user_asin_idx on public.product_post_links (user_id, asin);
alter table public.product_post_links enable row level security;
drop policy if exists product_post_links_own_read on public.product_post_links;
create policy product_post_links_own_read on public.product_post_links
  for select to authenticated using (user_id = auth.uid());

create table if not exists public.brand_recaps (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  brand_key    text not null,
  brand_name   text,
  urls         text[] not null default '{}',
  asins        text[] not null default '{}',
  channel      text not null,
  ok           boolean not null default false,
  groups_sent  int,
  campaign_id  text,
  error        text,
  message      text,
  created_at   timestamptz not null default now()
);
create index if not exists brand_recaps_user_brand_idx on public.brand_recaps (user_id, brand_key, created_at desc);
alter table public.brand_recaps enable row level security;
drop policy if exists brand_recaps_own_read on public.brand_recaps;
create policy brand_recaps_own_read on public.brand_recaps
  for select to authenticated using (user_id = auth.uid());
