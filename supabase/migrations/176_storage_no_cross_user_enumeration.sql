-- 176_storage_no_cross_user_enumeration.sql
-- SECURITY FIX: the headshots / ad-banners / product-images buckets each shipped
-- with a SELECT policy `for select to public using (bucket_id = '<b>')` — no
-- per-user folder scope. `public` includes the anon role, and the anon key ships
-- to the browser, so ANY visitor could hit the Storage LIST API
-- (storage.from('headshots').list('') → folders are user IDs → list each) and
-- enumerate + read every user's uploads, including the admin's real face photos.
-- Isolation was resting on path-unguessability, which listing defeats.
--
-- Fix: replace the blanket public-read policy with an OWNER-scoped one for the
-- authenticated API (list + authenticated download). This blocks anonymous
-- enumeration and cross-user listing. Public-URL downloads are UNAFFECTED — the
-- buckets stay `public: true`, and Supabase serves /object/public/<bucket>/<path>
-- straight from the CDN without consulting these policies, so og-image / fal /
-- IG-CDN fetches by URL keep working. (Confidentiality of a known object then
-- rests on its unguessable UUID path, same model as the rest of the app.)
--
-- NOTE: for STRONGER privacy on real face photos specifically, a follow-up can
-- flip `headshots` to private + signed URLs — bigger change, needs the render
-- pipeline to hand fal a signed URL, so it's intentionally out of scope here.

-- Idempotent: drop the old public policy AND any prior run of the new one
-- before re-creating, so this is safe to run more than once.

-- headshots
DROP POLICY IF EXISTS "Public read headshots" ON storage.objects;
DROP POLICY IF EXISTS "Owner reads own headshots" ON storage.objects;
CREATE POLICY "Owner reads own headshots" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'headshots' AND (storage.foldername(name))[1] = auth.uid()::text);

-- ad-banners
DROP POLICY IF EXISTS "Public read banners" ON storage.objects;
DROP POLICY IF EXISTS "Owner reads own banners" ON storage.objects;
CREATE POLICY "Owner reads own banners" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'ad-banners' AND (storage.foldername(name))[1] = auth.uid()::text);

-- product-images
DROP POLICY IF EXISTS "Public read product images" ON storage.objects;
DROP POLICY IF EXISTS "Owner reads own product images" ON storage.objects;
CREATE POLICY "Owner reads own product images" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'product-images' AND (storage.foldername(name))[1] = auth.uid()::text);
