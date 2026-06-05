-- 095_admin_uploads_bucket.sql
-- ─────────────────────────────────────────────────────────────────────────
-- Dedicated `admin-uploads` Storage bucket for admin-only staging files
-- (currently: the weekly Amazon Creator Connections export .zip uploaded
-- from /admin/creator-campaigns before it's parsed server-side).
--
-- Why a separate bucket: the admin upload was previously stashing the
-- zip in `instagram-videos`, which is misleading (the file has nothing
-- to do with Instagram) and inherits whatever RLS the IG bucket has.
-- Dedicated bucket = obvious intent + tight RLS that only admins can
-- read or write.
--
-- Bucket properties:
--   public:           false (signed URLs only; nothing here is meant for
--                     end users)
--   file_size_limit:  500 MB — Amazon's weekly export ranges from 30 MB
--                     to a few hundred MB.
--   allowed_mime:     application/zip + application/x-zip-compressed
--                     (browsers send one or the other depending on OS).

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'admin-uploads',
  'admin-uploads',
  false,
  524288000, -- 500 MB
  array['application/zip', 'application/x-zip-compressed']
)
on conflict (id) do nothing;

-- ── RLS ─────────────────────────────────────────────────────────────────
-- Only authenticated users whose `integrations.tier = 'admin'` can write
-- to this bucket. The objects are stored under `<user_id>/...` so each
-- admin's uploads are siloed. The server fetches the file via a signed
-- URL minted with the admin's session token; the service-role key path
-- in the API route bypasses RLS entirely once the URL is signed, so
-- these policies only gate the CLIENT-SIDE upload + URL minting.

drop policy if exists "admin uploads can write" on storage.objects;
create policy "admin uploads can write"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'admin-uploads'
  and exists (
    select 1 from public.integrations
    where user_id = auth.uid() and tier = 'admin'
  )
  and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists "admin uploads can read own" on storage.objects;
create policy "admin uploads can read own"
on storage.objects for select to authenticated
using (
  bucket_id = 'admin-uploads'
  and exists (
    select 1 from public.integrations
    where user_id = auth.uid() and tier = 'admin'
  )
  and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists "admin uploads can delete own" on storage.objects;
create policy "admin uploads can delete own"
on storage.objects for delete to authenticated
using (
  bucket_id = 'admin-uploads'
  and exists (
    select 1 from public.integrations
    where user_id = auth.uid() and tier = 'admin'
  )
  and (storage.foldername(name))[1] = auth.uid()::text
);
