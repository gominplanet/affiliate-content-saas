-- 216 — make the weekly catalog merge bulletproof against the enrichment cron.
--
-- After 215 gave the merge 180s of statement_timeout, the next failure was
-- "canceling statement due to lock timeout": the merge batch tries to lock rows
-- the enrichment cron is mid-update on, and a short lock_timeout cancels the
-- wait. Two fixes, belt + suspenders:
--
--   1. lock_timeout = 0 on service_role — the merge WAITS for a brief cron lock
--      (each cron update is a fast, auto-committed statement) instead of being
--      cancelled. statement_timeout (180s from 215) still bounds the total, and
--      service_role is server-only so nothing a browser reaches is affected.
--
--   2. A tiny flag table the import sets while a merge is running; the enrichment
--      cron reads it and skips its run, so during an import there is NO writer
--      competing with the merge at all (also makes the merge faster — no waits).
--      The flag carries updated_at so an abandoned import can't disable
--      enrichment forever: the cron ignores it once it's stale (see the route).
ALTER ROLE service_role SET lock_timeout = 0;

CREATE TABLE IF NOT EXISTS system_flags (
  key        text PRIMARY KEY,
  active     boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now()
);

NOTIFY pgrst, 'reload config';
