-- 404: Design memory, one per (user, product, format).
--
-- product_images remembers ONE picture per product: its 16:9 thumbnail. A pin,
-- an Instagram post, a Facebook post, a story and a Shorts cover are different
-- shapes of design for the same product, and none was kept unless it was
-- posted, so an unposted pin could never be offered back and was paid for again.
--
-- One row per format; making a new one for the same format replaces it.
-- The image itself is MVP's own copy in the product-images storage bucket.
--
-- Safe to run twice.

create table if not exists public.product_designs (
  user_id     uuid        not null references auth.users(id) on delete cascade,
  asin        text        not null,
  format      text        not null,
  image_url   text        not null,
  surface     text,
  model_used  text,
  created_at  timestamptz not null default now(),
  primary key (user_id, asin, format)
);

create index if not exists product_designs_user_recent_idx
  on public.product_designs (user_id, created_at desc);

alter table public.product_designs enable row level security;

drop policy if exists "product_designs own select" on public.product_designs;
create policy "product_designs own select" on public.product_designs
  for select using (auth.uid() = user_id);

drop policy if exists "product_designs own insert" on public.product_designs;
create policy "product_designs own insert" on public.product_designs
  for insert with check (auth.uid() = user_id);

drop policy if exists "product_designs own update" on public.product_designs;
create policy "product_designs own update" on public.product_designs
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "product_designs own delete" on public.product_designs;
create policy "product_designs own delete" on public.product_designs
  for delete using (auth.uid() = user_id);
