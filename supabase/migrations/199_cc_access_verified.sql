-- 199 — Gate the CC catalog "Browse all" to verified affiliates only.
--
-- The shared Creator Connections campaign catalog is reference data Amazon
-- shares with invited creators. To keep it from being visible to paid members
-- who don't themselves have CC access, "Browse all" now requires proof: SCOUT
-- must confirm the user's own Amazon Creator Connections grid actually renders
-- for them. When it does, we stamp this timestamp; the browse endpoints require
-- a recent stamp. Smart Scan is unaffected (it already reads the user's own
-- grid, so it's self-gating).
ALTER TABLE integrations
  ADD COLUMN IF NOT EXISTS cc_verified_at timestamptz;

NOTIFY pgrst, 'reload schema';
