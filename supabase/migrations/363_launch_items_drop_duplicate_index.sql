-- 363 — drop the duplicate launch_items index.
--
-- Migration 357 created two indexes over the same columns on the same table:
-- the unique constraint `unique (batch_id, position)` (which makes its own
-- index, launch_items_batch_id_position_key) and, right below it, a separate
-- `create index launch_items_batch_idx on launch_items (batch_id, position)`.
-- Both cover the identical column pair, so every insert and update to
-- launch_items has been maintaining two indexes to answer one query.
--
-- The unique constraint's index stays: it is also what enforces one position
-- per batch, not just a read path. The plain index buys nothing on top of it,
-- so this drops that one, the same fix already made for youtube_videos in
-- migration 322.
--
-- Safe to run twice.

drop index if exists public.launch_items_batch_idx;
