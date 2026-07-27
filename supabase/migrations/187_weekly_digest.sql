-- 187 — Weekly Deal Digest scheduling state.
--
-- Phase 2 of the Keepa content loop: an opt-in weekly "Top Deals in your niche"
-- roundup post. The opt-in itself already lives in the JSONB
-- integrations.notification_preferences->>'weekly_digest' (migration 004). This
-- adds the cron's round-robin bookkeeping so it picks the least-recently-digested
-- opted-in users each run and never double-sends within a week.
ALTER TABLE integrations
  ADD COLUMN IF NOT EXISTS last_weekly_digest_at timestamptz;

-- The cron orders opted-in users by this column (oldest / never first).
CREATE INDEX IF NOT EXISTS integrations_weekly_digest_idx
  ON integrations (last_weekly_digest_at ASC NULLS FIRST);
