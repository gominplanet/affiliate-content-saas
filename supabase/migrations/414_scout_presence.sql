-- Migration 414: which members have SCOUT, and is it working.
--
-- SCOUT uploads bulk videos through YouTube Studio and posts first comments
-- from the member's own Chrome, at no cost to the one YouTube quota every
-- account shares. Nothing recorded who had it, so nobody could tell whether a
-- member's uploads were waiting on a SCOUT they never installed. Every
-- dashboard visit in Chrome now says what it found (components/layout/
-- ScoutRequired.tsx, app/api/scout/seen).
--
-- Written by the server only (service role). Safe to run twice.

alter table public.integrations add column if not exists scout_version text;
alter table public.integrations add column if not exists scout_install text;
alter table public.integrations add column if not exists scout_background boolean;
alter table public.integrations add column if not exists scout_seen_at timestamptz;

notify pgrst, 'reload schema';
