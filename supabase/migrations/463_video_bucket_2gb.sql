-- 463: videos uploaded to MVP go up to 2 GB (lib/clip-source-limits
-- BULK_VIDEO_MAX_BYTES; it was 800 MB, migration 421). A DJI Osmo Pocket 3
-- records about 300 MB a minute even at 1080p, so 800 MB was under three
-- minutes (Seb, 2026-11-04: a 4:48 review was 1.42 GB). The project-wide
-- upload limit in the Supabase dashboard (Storage, Settings) must be at least
-- this too. Safe to run twice.
update storage.buckets set file_size_limit = 2147483648 where id = 'instagram-videos';
