-- Migration 375: comparison videos, the products a video compares.
--
-- A comparison video covers two to four products. youtube_videos.asin stays
-- the video's first product, so everything that reads one product keeps
-- working; asins holds every product in the order the creator set them, so
-- the description, the thumbnail and "On sale now" can cover all of them.
-- Null on an ordinary one-product video.
--
-- Safe to run twice.

alter table public.youtube_videos add column if not exists asins text[];
