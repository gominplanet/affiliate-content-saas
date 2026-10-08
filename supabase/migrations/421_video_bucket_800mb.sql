-- 421: Bulk Amazon upload takes videos up to 800 MB (lib/clip-source-limits
-- BULK_VIDEO_MAX_BYTES), but the storage bucket the videos go into kept its
-- own lower size limit, so a 679 MB video was refused (Seb, 2026-10-08).
-- Raises the bucket's limit to 800 MB. The project-wide upload limit in the
-- Supabase dashboard (Storage, Settings) must be at least this too.
-- Safe to run twice.
update storage.buckets set file_size_limit = 838860800 where id = 'instagram-videos';
