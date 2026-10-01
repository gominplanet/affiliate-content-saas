-- 392: prices taken out of the review data on every published post.
--
-- Amazon allows a price on a page only from its own API with a time stamp, so
-- MVP no longer writes one into a post's review data (JSON-LD), and a
-- background job takes it out of posts that still carry one. This records
-- which posts it has looked at, so each is read once. Safe to run more than once.
alter table public.blog_posts add column if not exists schema_price_checked_at timestamptz;

create index if not exists blog_posts_schema_price_unchecked
  on public.blog_posts (created_at desc)
  where schema_price_checked_at is null and wordpress_post_id is not null;

notify pgrst, 'reload schema';
