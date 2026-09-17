-- 339 — blog_posts.images_hosted_count: tell "on your site" from "pointing at ours"
--
-- images_status said 'ready' whenever pictures ended up in the post. When the
-- creator's site refused a media upload, the generator fell back to embedding
-- the URL it had generated the picture from, and that fallback counted as a
-- success. So a site that had stopped accepting uploads entirely produced a run
-- of posts marked 'ready'.
--
-- That cost a real diagnosis. A creator with 231 posts asked why his pictures
-- were not showing; his rows said 0 failed and 23 ready, which reads as a clean
-- upload path, and the answer was the opposite: his site had not accepted a
-- single image since August. His own live posts showed it, with 45 pictures
-- hosted on his domain in July and none at all afterwards.
--
-- So the count is recorded beside the total, and images_status gains
-- 'hotlinked' for the in-between state that used to hide inside 'ready'.
--
-- Safe to run twice.

alter table public.blog_posts
  add column if not exists images_hosted_count integer;

comment on column public.blog_posts.images_hosted_count is
  'How many of body_images_count actually uploaded to the creator''s own site. Below body_images_count means the rest are pointing at the URL MVP generated them from, which is a site that is refusing uploads, not a working post.';

comment on column public.blog_posts.images_status is
  'pending | ready | hotlinked | failed | skipped. ready means every picture is on the creator''s own site. hotlinked means one or more had to point at MVP''s generation URL because the site refused the upload.';
