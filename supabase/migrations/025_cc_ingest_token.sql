-- Migration 025: Creator Connections ingest token
--
-- The Phase 2 Chrome extension scrapes Amazon Creator Connections
-- campaigns and pushes them into the user's "CC Campaigns" list as
-- `pending` rows. The extension runs on amazon.com (cross-origin) and
-- has no dashboard session cookie, so it authenticates with a per-user
-- bearer token the user pastes into the extension once.
--
-- Idempotent.

alter table public.integrations
  add column if not exists cc_ingest_token text;

create unique index if not exists integrations_cc_ingest_token_idx
  on public.integrations (cc_ingest_token)
  where cc_ingest_token is not null;
