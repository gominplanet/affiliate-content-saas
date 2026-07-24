-- 178 — Shorts Studio: turn one long-form YouTube video into short vertical clips.
--
-- The blog generator takes a video → an article. Shorts Studio takes the SAME
-- video → a set of 15–30s vertical clips with burned-in subtitles. The "brain"
-- (Claude reading the timestamped transcript to pick the best moments) needs no
-- video file and runs for every user; the "factory" (Cloudinary trims the clip,
-- reframes to 9:16, burns the captions) activates once the creator uploads the
-- source MP4 — same no-server-pull rule the Instagram burner already respects.
--
-- One row per suggested/rendered clip. `subtitles` is the clip-RELATIVE caption
-- timeline (0 = clip start) so the render never has to re-derive timings.

CREATE TABLE IF NOT EXISTS youtube_shorts (
  id               uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id          uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  -- The source long-form video this clip was cut from.
  video_id         uuid NOT NULL REFERENCES youtube_videos(id) ON DELETE CASCADE,
  youtube_video_id text,                         -- native YouTube id (for deep-links)

  -- Clip window on the SOURCE timeline (seconds).
  start_sec        numeric NOT NULL,
  end_sec          numeric NOT NULL,

  -- The plan (from the transcript). hook = the on-clip title; caption = the
  -- suggested overlay caption; reason = why Claude picked it; score 0–100.
  hook             text NOT NULL DEFAULT '',
  caption          text NOT NULL DEFAULT '',
  reason           text NOT NULL DEFAULT '',
  score            integer NOT NULL DEFAULT 0,
  hashtags         jsonb   NOT NULL DEFAULT '[]'::jsonb,   -- string[]
  -- Clip-relative subtitle timeline: [{ startSec, endSec, text }] (0 = clip start).
  subtitles        jsonb   NOT NULL DEFAULT '[]'::jsonb,

  -- Render output (null until the creator renders it via Cloudinary).
  status           text NOT NULL DEFAULT 'suggested',       -- suggested | rendered | failed
  rendered_url     text,
  cloudinary_id    text,                          -- derived-asset public id (credit cleanup)
  subtitle_style   text NOT NULL DEFAULT 'bold-white',
  render_error     text,

  created_at       timestamptz NOT NULL DEFAULT now(),
  rendered_at      timestamptz,
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS youtube_shorts_user_video_idx
  ON youtube_shorts (user_id, video_id, start_sec);

ALTER TABLE youtube_shorts ENABLE ROW LEVEL SECURITY;

-- Users only ever touch their own clips (the API runs under the user's session).
DROP POLICY IF EXISTS "own youtube shorts" ON youtube_shorts;
CREATE POLICY "own youtube shorts" ON youtube_shorts
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- The SOURCE long-form MP4 the creator uploads to be chopped. Kept SEPARATE
-- from instagram_video_url (which is a finished vertical Short): a Shorts-Studio
-- source is the full horizontal video, not a clip. cloudinary_source_id caches
-- the one-time Cloudinary upload so rendering N clips from the same video only
-- uploads the (large) source once.
ALTER TABLE youtube_videos
  ADD COLUMN IF NOT EXISTS source_video_url         text,
  ADD COLUMN IF NOT EXISTS source_video_uploaded_at timestamptz,
  ADD COLUMN IF NOT EXISTS cloudinary_source_id     text;
