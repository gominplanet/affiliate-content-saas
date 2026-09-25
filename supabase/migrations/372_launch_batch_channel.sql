-- Migration 372: the YouTube channel a batch uploads to, confirmed first.
--
-- Liftoff uploaded every batch to whichever channel was marked default, and
-- nothing checked it before ten videos went up. A Google login can belong to a
-- different channel than the one its row is named after (a Brand Account picks
-- its channel at sign-in), so the default could be the wrong channel with
-- nothing on screen saying so.
--
-- This holds the YouTube channel id (UC...) the creator confirmed for the
-- batch, after MVP asked YouTube which channel the saved login really uploads
-- to. Null means not confirmed yet, and the batch cannot launch to YouTube.
--
-- Safe to run twice.

alter table public.launch_batches add column if not exists youtube_channel_id text;
