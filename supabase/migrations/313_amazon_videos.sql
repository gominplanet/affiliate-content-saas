-- 313 — The creator's Amazon video library, and which products each video sells.
--
-- Amazon's Manage content page fetches /manage-content/api/get-content-list,
-- which returns every video the creator has published, with real engagement on
-- each one: views, hearts, average percent viewed, average view duration. That
-- answers "which video is working" on its own.
--
-- What that list does NOT return is the products. Each record carries only
-- contentDetail.totalProductCount, a number, so linking a video to an ASIN needs
-- a second call per video. Hence two tables: the library, which one call fills,
-- and the video-to-product links, which are filled incrementally afterwards.
--
-- Videos are keyed by ACI (Amazon Content Identifier), Amazon's own id for a
-- piece of content. It is the only stable handle the list gives us, and it is
-- what the per-video detail call takes.

create table if not exists public.amazon_videos (
  user_id        uuid not null references auth.users(id) on delete cascade,
  -- contentDetail.mediaACI. Amazon's id for this video.
  aci            text not null,
  -- The creator's own words for the video. Amazon files this as a description;
  -- there is no separate title field.
  description    text,
  -- PUBLISHED / PROCESSING / REJECTED and so on, verbatim from Amazon so a new
  -- state never gets silently mapped onto an existing one.
  state          text,
  program        text,
  marketplace_id text,
  duration_sec   numeric,
  media_url      text,
  -- Engagement, exactly as Amazon reports it. Null means Amazon did not report
  -- the metric, which is not the same as zero, and the UI must keep that apart.
  views          integer,
  hearts         integer,
  avg_pct_viewed numeric,
  avg_view_sec   numeric,
  -- How many products Amazon says this video features. Kept because it tells us
  -- whether the product crawl for this video is complete without re-fetching it.
  product_count  integer,
  published_at   timestamptz,
  modified_at    timestamptz,
  -- When the per-video product call last succeeded. Null means never fetched,
  -- which is how the crawl knows what is left to do and can resume.
  products_synced_at timestamptz,
  synced_at      timestamptz not null default now(),
  primary key (user_id, aci)
);

create index if not exists amazon_videos_user_idx
  on public.amazon_videos (user_id, views desc nulls last);
-- The crawl's work queue: videos with products that have never been fetched.
create index if not exists amazon_videos_pending_idx
  on public.amazon_videos (user_id, products_synced_at)
  where products_synced_at is null;

-- ── Which products each video sells ─────────────────────────────────────────
-- A video can feature several products and a product can appear in several
-- videos, so this is a plain join table rather than a column on either side.
create table if not exists public.amazon_video_products (
  user_id    uuid not null references auth.users(id) on delete cascade,
  aci        text not null,
  asin       text not null,
  title      text,
  synced_at  timestamptz not null default now(),
  primary key (user_id, aci, asin)
);

-- "Which videos sell this product" is the whole point, so the ASIN side is
-- indexed as well as the video side.
create index if not exists amazon_video_products_asin_idx
  on public.amazon_video_products (user_id, asin);

alter table public.amazon_videos         enable row level security;
alter table public.amazon_video_products enable row level security;

-- Read-only to the owner. Writes go through the ingest route on the service
-- role, the same rule as the earnings tables.
drop policy if exists "own amazon videos" on public.amazon_videos;
create policy "own amazon videos" on public.amazon_videos
  for select using (auth.uid() = user_id);

drop policy if exists "own amazon video products" on public.amazon_video_products;
create policy "own amazon video products" on public.amazon_video_products
  for select using (auth.uid() = user_id);

notify pgrst, 'reload schema';
