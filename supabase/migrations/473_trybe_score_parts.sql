-- 473: TRYBE's score in its three parts (Seb, 2026-11-25, with arrae's TRYBE
-- Score open: Submission reviews 16 slow, Launching ads 91 fast, Chat
-- responsiveness 16 slow; "These do all have to be taken into consideration
-- when MVP gives their recommendation").
--
-- Read through a member's SCOUT from the brand's TRYBE details and kept on
-- MVP's shared copy, so the MVP pick weighs them for everyone
-- (lib/trybe-score, lib/trybe-pick "Easy to work with"):
--   trybe_score_parts  { reviews, ads, chat }, each 0 to 100
--   trybe_score_at     when the score was last read
--
-- Safe to run twice.

alter table public.trybe_directory add column if not exists trybe_score_parts jsonb;
alter table public.trybe_directory add column if not exists trybe_score_at timestamptz;

notify pgrst, 'reload schema';
