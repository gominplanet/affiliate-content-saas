-- 189 — New-deal niche alerts scheduling state.
--
-- Extends Price Alerts from "watched products" to DISCOVERY: a cron surfaces
-- brand-new real deals in a creator's niche into their dashboard alerts box
-- (price_alerts.kind = 'new_niche_deal', from migration 186's table — no schema
-- change there, kind is free text). This column is the cron's round-robin +
-- cooldown bookkeeping so a user isn't re-scanned/flooded every run.
ALTER TABLE integrations
  ADD COLUMN IF NOT EXISTS last_niche_alert_at timestamptz;

CREATE INDEX IF NOT EXISTS integrations_niche_alert_idx
  ON integrations (last_niche_alert_at ASC NULLS FIRST);
