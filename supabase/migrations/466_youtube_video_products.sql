-- 466: the products each YouTube upload links to (Seb, 2026-11-11: "is there a
-- way to look at all of the youtube videos ive uploaded and see what is
-- missing when you look at my amazon storefront?").
--
-- An Amazon video does not say which YouTube video it came from, so the two
-- are matched by product: the ASINs in each YouTube video's title and
-- description links (geni.us, amzn.to and a.co followed to the product),
-- against amazon_video_products. A video can link several products, so they
-- get their own table; youtube_videos keeps when its links were read and, when
-- none led to a product, why.
--
-- Safe to run twice.

create table if not exists public.youtube_video_products (
  user_id          uuid not null references auth.users(id) on delete cascade,
  youtube_video_id text not null,
  asin             text not null,
  -- Where the ASIN came from: the title, or the link in the description.
  via              text,
  created_at       timestamptz not null default now(),
  primary key (user_id, youtube_video_id, asin)
);

create index if not exists youtube_video_products_asin_idx
  on public.youtube_video_products (user_id, asin);

alter table public.youtube_video_products enable row level security;

drop policy if exists "own youtube video products" on public.youtube_video_products;
create policy "own youtube video products" on public.youtube_video_products
  for select using (auth.uid() = user_id);

alter table public.youtube_videos add column if not exists products_read_at timestamptz;
alter table public.youtube_videos add column if not exists products_why text;
