-- Migration 018: Separate 9:16 image for Instagram Stories
--
-- The feed-post image is 1080×1350 (4:5). When that image is published
-- to a Story, Instagram zoom-crops it to fill 1080×1920 (9:16), cutting
-- off the title and CTA. We now generate a second image at 1080×1920
-- specifically for the Story surface — same elements, more vertical
-- breathing room, designed within IG's safe zones.
--
-- The compose route renders both sizes at the same time and uploads both
-- to the `instagram-images` bucket (paths: {user}/{videoId}.png and
-- {user}/{videoId}-story.png).

alter table public.youtube_videos
  add column if not exists instagram_story_image_url text;
