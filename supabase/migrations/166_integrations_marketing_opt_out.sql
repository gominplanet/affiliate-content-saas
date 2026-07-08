-- 166 — Marketing / broadcast email opt-out per user.
--
-- The admin broadcast tool (/admin/broadcast → /api/admin/broadcast) emails
-- trial + paid MVP users. CAN-SPAM requires a working unsubscribe, so every
-- broadcast carries a one-click List-Unsubscribe link that flips this flag,
-- and the recipient query excludes anyone with it set to true.
--
-- Defaults to false (opted IN) for all existing users — they can unsubscribe
-- from any broadcast. Auth/transactional email (signup, password reset, plan
-- changes) is unaffected; this only gates operator broadcasts.

ALTER TABLE integrations
  ADD COLUMN IF NOT EXISTS marketing_opt_out boolean NOT NULL DEFAULT false;

-- Partial index: the broadcast recipient scan only ever filters on the opted-in
-- set, so index just those rows (keeps it tiny).
CREATE INDEX IF NOT EXISTS idx_integrations_marketing_opt_in
  ON integrations (user_id)
  WHERE marketing_opt_out = false;
