-- Migration 129: record the source video set on multi-video posts (buying
-- guides + comparisons) so the SAME line-up can never be published twice.
--
-- WHY: /api/blog/comparison builds a guide/comparison from 2-10 YouTube URLs
-- but never recorded WHICH videos it used, so nothing stopped a user from
-- generating a second post from the same videos (e.g. one "comparison"-style
-- title and one "buying guide"-style title for the identical line-up). Worse,
-- the old insert wrote the 11-char YouTube id into the uuid `video_id` column,
-- which failed the whole insert silently (invalid uuid) — so these posts were
-- never tracked in blog_posts at all, and the dedup had nothing to check.
--
-- This column stores the SORTED list of source YouTube video ids. The route
-- now (a) inserts video_id = null for multi-video posts (like campaign posts;
-- migration 024 already made it nullable) and (b) refuses to publish when a
-- published guide/comparison with the same source_video_ids set already
-- exists.
--
-- Idempotent: safe to re-run.

alter table public.blog_posts
  add column if not exists source_video_ids text[];

comment on column public.blog_posts.source_video_ids is
  'Sorted YouTube video ids a multi-video guide/comparison was built from (dedup key). NULL for single-video reviews + campaigns.';
