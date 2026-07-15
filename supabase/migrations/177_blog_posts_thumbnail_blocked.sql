-- 177_blog_posts_thumbnail_blocked.sql
-- Durable marker for "this post published but its featured thumbnail could NOT
-- be uploaded to WordPress" (host WAF/security plugin blocking /wp/v2/media, or
-- the connected WP user losing the upload_files capability). blog/generate sets
-- it on a fresh generate when the upload fails after a retry; the re-attach heal
-- (/api/blog/reattach-thumbnails) clears it once the image lands. Lets the SEO
-- page show a "N posts missing thumbnails · Re-attach" banner and the admin
-- dashboard flag which sites are being blocked — WITHOUT re-fetching every post
-- from WordPress to check featured_media.
--
-- Idempotent. Default false keeps every existing row unaffected.
alter table public.blog_posts
  add column if not exists thumbnail_blocked boolean not null default false;

-- Partial index: every reader only wants the blocked rows (a tiny minority), so
-- this stays small and keeps the "which of my posts are missing a thumbnail"
-- and admin "which sites are blocked" queries off a full scan.
create index if not exists blog_posts_thumbnail_blocked_idx
  on public.blog_posts (user_id)
  where thumbnail_blocked;
