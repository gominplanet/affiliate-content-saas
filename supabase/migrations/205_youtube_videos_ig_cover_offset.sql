-- 205 — Instagram Reel COVER frame, chosen in MVP.
--
-- WHY: when MVP publishes a Reel, Instagram defaults the cover to the first
-- frame (often a bad/blurry moment), forcing the creator to open the IG app and
-- scrub to a better frame by hand. This stores the frame the creator picked in
-- MVP (milliseconds into the 9:16 render); the IG publish then passes it as
-- `thumb_offset`, so the Reel goes out with the right cover — no IG round-trip.
-- NULL = let Instagram pick (frame 0), the previous behaviour.

ALTER TABLE public.youtube_videos
  ADD COLUMN IF NOT EXISTS ig_cover_offset_ms integer;

COMMENT ON COLUMN public.youtube_videos.ig_cover_offset_ms IS
  'Instagram Reel cover frame, in ms into the 9:16 render, chosen by the creator in MVP. Passed as thumb_offset at publish. NULL = IG default (frame 0).';
