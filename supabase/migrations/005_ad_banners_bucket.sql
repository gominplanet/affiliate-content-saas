-- Public storage bucket for affiliate banner images uploaded via Customize Blog
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'ad-banners',
  'ad-banners',
  true,
  5242880, -- 5 MB
  array['image/png','image/jpeg','image/gif','image/webp','image/svg+xml']
)
on conflict (id) do nothing;

-- Users can upload to their own folder, anyone can read (public bucket)
drop policy if exists "Users upload own banners" on storage.objects;
create policy "Users upload own banners"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'ad-banners' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "Users update own banners" on storage.objects;
create policy "Users update own banners"
  on storage.objects for update
  to authenticated
  using (bucket_id = 'ad-banners' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "Users delete own banners" on storage.objects;
create policy "Users delete own banners"
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'ad-banners' and (storage.foldername(name))[1] = auth.uid()::text);

-- "Public read banners" (select, to public, the whole bucket) used to be
-- created here. Migration 176 dropped it because it let anyone list every
-- creator's files; the bucket is public, so a file's URL still works without
-- it. It is not created here any more, so running this file again can never
-- bring it back.
drop policy if exists "Public read banners" on storage.objects;
