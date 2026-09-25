-- Migration 370: a title of its own for Amazon.
--
-- Liftoff used one title for YouTube and every Amazon store. YouTube wants a
-- longer, search-shaped title; an Amazon storefront video wants a short hook in
-- the creator's storefront style. The Amazon title lives beside the YouTube one,
-- and every non-English store's title is translated from it.
--
-- Safe to run twice.

alter table public.launch_items add column if not exists amazon_title text;
alter table public.youtube_videos add column if not exists amazon_title text;
