-- 083 — Direct-push Instagram tracking on youtube_videos
--
-- Mirrors migration 081/082 (TikTok) for Instagram. Lets the Vertical
-- Videos tab post straight from a Short to IG Reels (and optionally
-- Stories) WITHOUT first generating a blog post — the YT video carries
-- its own IG publish history.
--
-- Column names match blog_posts.instagram_reel_id / instagram_story_id
-- so the IG service can treat both targets uniformly.

alter table public.youtube_videos
  -- IG Reel container id once the publish completes. Null while
  -- processing (IG takes ~30-60s) or if Reel wasn't published.
  add column if not exists instagram_reel_id   text,
  -- IG Story container id. Story + Reel can both be posted from the
  -- same direct push; one column tracks each.
  add column if not exists instagram_story_id  text,
  -- Stamped when the FIRST IG push (Reel or Story) completes. Powers
  -- the "Posted to IG" pill state on the row.
  add column if not exists instagram_posted_at timestamptz;

-- Fast lookup for the "recently posted to IG" widget on the dashboard.
create index if not exists youtube_videos_instagram_posted_idx
  on public.youtube_videos (user_id, instagram_posted_at desc)
  where instagram_posted_at is not null;
