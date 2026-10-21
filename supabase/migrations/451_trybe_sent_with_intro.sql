-- Migration 451: whether a TRYBE request went with the intro video.
--
-- Seb, 2026-10-21: the intro video goes with every request SCOUT sends
-- (lib/trybe-intro, SCOUT 1.53.7). What happened is kept per request, so a
-- request sent without it (SCOUT older than 1.53.7, the video not on TRYBE,
-- or the intro turned off) never reads as one sent with it.
--
-- Safe to run twice.
alter table public.trybe_brands add column if not exists sent_with_intro boolean;
notify pgrst, 'reload schema';
