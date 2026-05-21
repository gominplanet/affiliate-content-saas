-- 051 — Per-video product reference photo (user upload)
--
-- The blog in-body images + IG AI image render the product via Kontext,
-- which needs a clean reference photo of the product. We auto-fetch one
-- from Amazon by ASIN, but that's fragile (blocked scrapes, wrong
-- variant, no resolvable ASIN). Letting the user upload the exact
-- product photo is more reliable and higher quality — it takes priority
-- over the Amazon fetch, which stays as the fallback.

alter table public.youtube_videos
  add column if not exists product_image_url text;

-- Public storage bucket for user-uploaded product reference photos.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'product-images',
  'product-images',
  true,
  10485760, -- 10 MB
  array['image/png','image/jpeg','image/webp']
)
on conflict (id) do nothing;

-- Per-user ownership: first path segment must be the user's id, matching
-- the {user_id}/{file} convention used by the other buckets.
create policy "Users upload own product image"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'product-images' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "Users update own product image"
  on storage.objects for update
  to authenticated
  using (bucket_id = 'product-images' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "Users delete own product image"
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'product-images' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "Public read product images"
  on storage.objects for select
  to public
  using (bucket_id = 'product-images');
