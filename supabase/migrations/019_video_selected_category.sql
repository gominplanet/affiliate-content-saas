-- Migration 019: Per-video category override
--
-- The Haiku-based auto-categorizer drifts — picks "Home & Kitchen" for a
-- gardening tool because the AI sees "kitchen-style storage" in the
-- description. Users need to manually pick the category before the post
-- ships, and to swap it later if they realize it's wrong.
--
-- We store the choice on the YouTube video row (not the blog post) so it
-- survives Rewrite / Regenerate cycles and is available pre-publish too.
-- When the user picks a category in the Content page dropdown:
--   1. We save it here
--   2. /api/blog/generate reads it and uses it instead of the AI's pick
--   3. /api/blog/update-category pushes any later change to WordPress

alter table public.youtube_videos
  add column if not exists selected_category text;
