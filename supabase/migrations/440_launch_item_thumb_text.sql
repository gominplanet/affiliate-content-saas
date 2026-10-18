-- 440 A video's own thumbnail text (Seb, 2026-10-18: "let users come up with
-- their own thumbnail titles ... anywhere MVP creates thumbnails").
--
-- Bulk Amazon upload and Drop build each video's thumbnail in the background
-- from the batch's look. This is the one line that look cannot carry: the
-- exact words for THIS video's thumbnail, or null for MVP's own. Checked by
-- lib/thumb-text before it is saved, and used as written.
--
-- Safe to run more than once.

alter table public.launch_items add column if not exists thumbnail_text text;

notify pgrst, 'reload schema';
