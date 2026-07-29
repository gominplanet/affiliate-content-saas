-- 198 — Cache each creator's resolved Creator Connections message URLs.
--
-- "Message the brand" needs the campaign's Amazon message page (detailsUrl),
-- which SCOUT can only read by loading the live CC grid in the browser and
-- scraping the link — slow (seconds to minutes), and re-done from scratch every
-- time. It is NOT constructible from campaign_id (it's read from Amazon's DOM),
-- and it's tied to the creator's own opportunities, so it's cached PER USER.
--
-- Once SCOUT resolves a campaign's URL (from a Message-brand find OR a Smart
-- Scan), we store it here; the next message to that campaign skips the grid
-- search and sends instantly. Self-heals: a failed send clears the row so it
-- re-resolves, and entries older than the app's TTL are treated as stale.
CREATE TABLE IF NOT EXISTS cc_message_links (
  user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  asin        text NOT NULL,
  campaign_id text,
  details_url text NOT NULL,
  resolved_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, asin)
);

ALTER TABLE cc_message_links ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "own cc_message_links" ON cc_message_links;
CREATE POLICY "own cc_message_links" ON cc_message_links
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

NOTIFY pgrst, 'reload schema';
