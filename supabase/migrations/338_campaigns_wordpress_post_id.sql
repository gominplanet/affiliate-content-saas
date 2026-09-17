-- 338 — campaigns.wordpress_post_id: stop a Retry from publishing a second post
--
-- A campaign row is only marked `published` at the very end of the generate
-- route, after three image uploads and an updatePost against the creator's own
-- host. An attempt that dies anywhere in that stretch leaves a LIVE WordPress
-- post and a row that knows nothing about it.
--
-- The status claim blocks an automatic retry: a dead run leaves the row at
-- `researching`, which is not claimable. But reset-stuck-campaigns flips
-- `researching` to `failed` after 10 minutes, a `failed` row IS claimable, and
-- the UI shows the creator a Retry button. Pressing it published a duplicate.
--
-- Recording the WordPress post id the instant WordPress accepts it turns that
-- re-run into an update of the post it already made.
--
-- Safe to run twice.

alter table public.campaigns
  add column if not exists wordpress_post_id bigint;

comment on column public.campaigns.wordpress_post_id is
  'The WordPress post this campaign published, written the moment WordPress accepts it (before the image uploads that follow). A re-run UPDATES this post instead of creating a second one.';
