-- Migration 064: store the connected Threads @username
--
-- The Threads OAuth callback fetches the profile handle so the app can show
-- "Connected as @username" (needed for the threads_basic App Review screencast,
-- which requires the connected profile info to be displayed). The connection
-- itself never depends on this column — the callback writes it best-effort.

alter table public.integrations
  add column if not exists threads_username text;
