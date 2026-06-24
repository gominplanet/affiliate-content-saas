-- Migration 139: CTA box (sticker) support for batch-scheduled burns
--
-- The single-video burner can overlay a pre-designed CTA box (a transparent
-- PNG) instead of plain caption text. Batch & schedule could only burn text.
-- Add a sticker_url column so a queued batch job can carry the chosen CTA box;
-- the worker burns the sticker when set, else falls back to caption_text.
-- NULL = caption-text mode (the existing behaviour), so old rows are unaffected.

alter table public.ig_burn_jobs
  add column if not exists sticker_url text;
