-- 224 — Geniuslink-wrapped blog link for social shares.
--
-- Opt-in: when a creator turns this on, social shares use a short branded
-- geni.us link to the blog post instead of the raw WordPress URL (which can be
-- an ugly ?p=123 on Plain permalinks, and is longer / less authoritative).
--
--   integrations.wrap_blog_geniuslink  — the per-user toggle (default OFF).
--   blog_posts.geniuslink_blog_url     — cached short link for THIS post's blog
--                                        URL, created once at generation time.
--
-- Social routes read `geniuslink_blog_url || wordpress_url`, so nothing changes
-- for users who leave it off or for posts that don't have a short link yet.

ALTER TABLE public.integrations
  ADD COLUMN IF NOT EXISTS wrap_blog_geniuslink boolean NOT NULL DEFAULT false;

ALTER TABLE public.blog_posts
  ADD COLUMN IF NOT EXISTS geniuslink_blog_url text;

COMMENT ON COLUMN public.integrations.wrap_blog_geniuslink IS
  'When true, social shares wrap the blog post URL in a geni.us short link (created at generation time, cached on blog_posts.geniuslink_blog_url).';
COMMENT ON COLUMN public.blog_posts.geniuslink_blog_url IS
  'Cached geni.us short link pointing at this post''s blog URL — used for social shares when the user enables wrap_blog_geniuslink.';
