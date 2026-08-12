-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 251 — system_flags.value (JSON state for the background CC merge)
--
-- The weekly CC catalog merge used to be driven by the admin's open browser tab
-- calling the merge endpoint in a loop (throttled to a crawl when the tab was
-- backgrounded — an all-night merge). A new cron (/api/cron/drain-cc-import)
-- drains it server-side instead, so the admin kicks it off and walks away.
--
-- The cron needs to carry state between one-minute ticks: which phase it's in
-- (merge vs purge) and the purge cursor. system_flags only had key/active/
-- updated_at, so this adds a free-form JSON column to hold that state on the
-- 'cc_import_drain' row.
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.system_flags
  add column if not exists value jsonb;
