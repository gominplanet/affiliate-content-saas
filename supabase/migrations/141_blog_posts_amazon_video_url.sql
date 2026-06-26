-- 141_blog_posts_amazon_video_url.sql
--
-- "Share with brand": store the creator's Amazon Influencer video link (the
-- /vdp/ URL on the product page) per post, discovered via the extension's
-- Manage Content scan and matched to the post by ASIN. NULL until found.
-- This is a legit "your content is live on Amazon" link for the brand recap.

ALTER TABLE public.blog_posts
  ADD COLUMN IF NOT EXISTS amazon_video_url text;

COMMENT ON COLUMN public.blog_posts.amazon_video_url IS
  'Creator''s Amazon Influencer video (vdp) URL for this post, matched by ASIN via the extension Manage Content scan. Shared in the brand recap.';
