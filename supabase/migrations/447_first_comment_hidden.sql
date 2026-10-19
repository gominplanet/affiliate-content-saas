-- Migration 447: videos a creator hid from Pinned comments.
--
-- Seb, 2026-10-19: "we need to be able to get rid of these videos we do not
-- want to see here", videos YouTube no longer has, listed with no title and
-- a cancelled draft. YouTube video ids. The video and its comment are never
-- touched: this only keeps them off the Pinned comments list, and Show again
-- puts them back.
--
-- Safe to run twice.
alter table public.integrations add column if not exists first_comment_hidden text[] not null default '{}';
notify pgrst, 'reload schema';
