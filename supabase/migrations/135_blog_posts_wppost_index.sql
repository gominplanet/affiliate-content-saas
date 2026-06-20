-- 135_blog_posts_wppost_index.sql
-- Speed up the WordPress-post-id lookups that run on EVERY social action for a
-- video-less post (resolveBlogPostId fallback) and on every /api/blog/content
-- GET/POST keyed by WP id. blog_posts already has (user_id, video_id) and
-- (user_id, status, published_at) indexes, but nothing covering wordpress_post_id,
-- so those filters do a per-user scan. Additive index — safe to run anytime.

create index if not exists blog_posts_user_wppost_idx
  on blog_posts (user_id, wordpress_post_id);
