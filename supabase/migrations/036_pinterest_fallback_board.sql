-- Migration 036: integrations.pinterest_fallback_board
--
-- The board name used for pins whose post has no specific category.
-- Categorized posts still go to an auto-created per-category board;
-- this is only the catch-all. User-set on the Integrations page; when
-- empty the publish path defaults to "Reviews". Stored as a NAME (not
-- a board id) so it works on fresh/sandbox accounts that have zero
-- boards yet — findOrCreateBoard creates it on first publish.
--
-- Idempotent.

alter table public.integrations
  add column if not exists pinterest_fallback_board text;
