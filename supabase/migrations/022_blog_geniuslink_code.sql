-- Migration 022: Per-post Geniuslink shortcode
--
-- Powers the /analytics page. When we create a Geniuslink link during
-- blog generation we now save the shortcode here so we can join Geniuslink's
-- click data back to the post that drove the click.
--
-- For posts created before this migration we don't have the code on the
-- row. The analytics endpoint backfills them on first hit by listing all
-- shortlinks via Geniuslink's API and matching on Note (we set Note to the
-- post title when creating).

alter table public.blog_posts
  add column if not exists geniuslink_code text;

create index if not exists blog_posts_geniuslink_code_idx
  on public.blog_posts (geniuslink_code)
  where geniuslink_code is not null;
