-- Migration 244: Remove VidIQ from MVP entirely.
--
-- MVP has no VidIQ integration and should not carry one. Migration 002 added
-- vidiq_snapshot + vidiq_api_key to integrations, and a since-deleted route
-- stamped a hardcoded channel snapshot into vidiq_snapshot. Drop both columns.
-- geniuslink_api_key (added in the same old migration) stays — it's a real,
-- in-use feature.

alter table public.integrations
  drop column if exists vidiq_snapshot,
  drop column if exists vidiq_api_key;
