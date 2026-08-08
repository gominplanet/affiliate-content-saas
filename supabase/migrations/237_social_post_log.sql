-- 237 — Social post pace log.
--
-- Records one row per successful API publish per platform, so we can pace posting
-- (min gap between posts, per-hour + per-day caps) and lower how often a user's
-- account trips a platform's automation/spam detector. Instagram is the first
-- consumer (accounts get restricted for bursty API posting), but the table is
-- platform-agnostic for reuse.
--
-- Deliberately tiny + append-only. The pace helper (lib/social-pace.ts) reads
-- recent rows for one user+platform; everything fails OPEN, so posting keeps
-- working even before this migration is applied.

CREATE TABLE IF NOT EXISTS social_post_log (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  platform    text NOT NULL,
  external_id text,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_social_post_log_user_platform_time
  ON social_post_log (user_id, platform, created_at DESC);

ALTER TABLE social_post_log ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "own social_post_log" ON social_post_log
    FOR ALL USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

NOTIFY pgrst, 'reload schema';
