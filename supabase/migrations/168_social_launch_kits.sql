-- 168 — Persist each user's Social Launch Kit, one saved slot per platform.
--
-- The kit (copy + banner + avatar) used to live only in the browser and vanished
-- on refresh. Now every generation is saved per (user, platform) so it stays on
-- the page and is there whenever the user is ready to set the account up. Copy
-- lives in `kit` (jsonb); images are uploaded to durable storage and only their
-- URLs are stored here (keeps rows tiny + page load fast). Regenerating a
-- platform overwrites its saved slot — one saved kit per social per user.

CREATE TABLE IF NOT EXISTS social_launch_kits (
  user_id    uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  platform   text NOT NULL,               -- facebook | pinterest | twitter | threads | bluesky | linkedin
  kit        jsonb,                        -- the generated copy kit (names/handles/bios/…)
  banner_url text,                         -- durable URL of the saved cover/banner (or null)
  avatar_url text,                         -- durable URL of the saved avatar (or null)
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, platform)
);

ALTER TABLE social_launch_kits ENABLE ROW LEVEL SECURITY;

-- Users only ever touch their own kits (the API runs under the user's session).
DROP POLICY IF EXISTS "own social launch kits" ON social_launch_kits;
CREATE POLICY "own social launch kits" ON social_launch_kits
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
