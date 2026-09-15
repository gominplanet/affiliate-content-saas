-- 331 — Product image memory: one approved image per (user, ASIN).
--
-- Today every image MVP makes is stored against the ARTIFACT it was made for
-- (youtube_videos.thumbnail_url, scheduled_posts.image_data, ...), never
-- against the product. And a thumbnail the creator UPLOADS in Co-Pilot is read
-- into a data URI in browser state and never persisted at all — once it is
-- pushed to YouTube it is gone from MVP entirely.
--
-- So: a pointer to the LAST image the creator approved for a product, whatever
-- its origin, that every other composer can offer back. Not an image cache.
-- The primary key is (user_id, asin) — approving a new one replaces it.
--
-- Safe to run twice.

create table if not exists public.product_images (
  user_id      uuid        not null references auth.users(id) on delete cascade,
  asin         text        not null,
  image_url    text        not null,
  -- Where the creator approved it. 'copilot-upload' is the one that cannot be
  -- reproduced by regenerating, so the UI names it differently.
  source       text        not null default 'generated',
  -- Human label for the surface it came from, e.g. 'YouTube Co-Pilot'.
  surface      text,
  model_used   text,
  approved_at  timestamptz not null default now(),
  created_at   timestamptz not null default now(),
  primary key (user_id, asin)
);

alter table public.product_images add column if not exists source text not null default 'generated';
alter table public.product_images add column if not exists surface text;
alter table public.product_images add column if not exists model_used text;
alter table public.product_images add column if not exists approved_at timestamptz not null default now();

create index if not exists product_images_user_recent_idx
  on public.product_images (user_id, approved_at desc);

alter table public.product_images enable row level security;

drop policy if exists "product_images own select" on public.product_images;
create policy "product_images own select" on public.product_images
  for select using (auth.uid() = user_id);

drop policy if exists "product_images own insert" on public.product_images;
create policy "product_images own insert" on public.product_images
  for insert with check (auth.uid() = user_id);

drop policy if exists "product_images own update" on public.product_images;
create policy "product_images own update" on public.product_images
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "product_images own delete" on public.product_images;
create policy "product_images own delete" on public.product_images
  for delete using (auth.uid() = user_id);

-- A deal post scheduled with a reused image must fire with THAT image. The
-- modal says "Reusing your thumbnail from Sep 14" at scheduling time, so
-- resolving it again at fire time (and silently picking up a newer one) would
-- make the screen a liar. Store what was chosen.
alter table public.deal_scheduled_posts add column if not exists image_override text;
