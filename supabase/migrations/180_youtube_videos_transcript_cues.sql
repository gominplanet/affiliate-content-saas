-- 180 — Cache word-level transcript cues so Clip Factory never re-transcribes.
--
-- The Shorts planner needs WORD-LEVEL timings (Whisper) to make captions land
-- on the beat. Getting them is the single most expensive step in the whole
-- pipeline: for a fetched (not-uploaded) video we pull the audio through the
-- metered residential proxy AND pay fal.ai for the Whisper pass. Before this,
-- every "Find Shorts" re-run repeated BOTH — so regenerating clips (a common
-- action) silently re-spent proxy bandwidth and Whisper money on a transcript
-- we already had.
--
-- We already cache the flattened `transcript` text (for the blog/metadata
-- paths), but that throws away the per-word timings the planner/caption engine
-- need — so it couldn't be reused here. These columns cache the structured
-- word-level cues ([{ start, end, text }], source-timeline seconds) once, and
-- the plan route loads them first on every subsequent run.
ALTER TABLE youtube_videos
  ADD COLUMN IF NOT EXISTS transcript_cues            jsonb,
  ADD COLUMN IF NOT EXISTS transcript_cues_fetched_at timestamptz;
