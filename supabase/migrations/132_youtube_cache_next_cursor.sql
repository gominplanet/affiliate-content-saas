-- Co-Pilot "Load more" fix (2026-06-16)
-- The drafts scan stops after MAX_PAGES (or early) and hands back a YouTube
-- pageToken so the UI can keep paging. That cursor was never persisted, so a
-- cached load (served for 15 min) always reported "all loaded" and hid the
-- "Load more" button — even when the channel had more drafts deeper in the
-- uploads list. Persist the cursor so a cached load can still offer more.
ALTER TABLE youtube_video_cache
  ADD COLUMN IF NOT EXISTS next_cursor text;
