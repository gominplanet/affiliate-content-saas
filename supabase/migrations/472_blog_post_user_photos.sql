-- 472: the creator's own photos, kept on the post (support, 2026-11-23: "Blog
-- 'Photos' not posting again even though we add them").
--
-- Photos chosen in the Schedule window used to live only in the browser, and a
-- slow write or a closed tab lost them. They now travel with the schedule
-- request and are placed where the post is written (lib/place-user-photos);
-- kept here as well, so Retry images and Add images place THOSE again instead
-- of AI pictures. Up to three https addresses (Supabase storage, product-images).
--
-- Written and read by the server only.
--
-- Safe to run twice.

alter table public.blog_posts add column if not exists user_image_urls jsonb;

notify pgrst, 'reload schema';
