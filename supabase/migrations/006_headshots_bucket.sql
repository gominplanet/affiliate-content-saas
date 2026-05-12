-- Public storage bucket for user headshot images (used by AI Thumbnail Generator)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'headshots',
  'headshots',
  true,
  5242880, -- 5 MB
  array['image/png','image/jpeg','image/webp']
)
on conflict (id) do nothing;

-- Each user can upload/update/delete their own headshot
create policy "Users upload own headshot"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'headshots' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "Users update own headshot"
  on storage.objects for update
  to authenticated
  using (bucket_id = 'headshots' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "Users delete own headshot"
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'headshots' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "Public read headshots"
  on storage.objects for select
  to public
  using (bucket_id = 'headshots');
