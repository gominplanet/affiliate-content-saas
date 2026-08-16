-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 259 — Real "last seen" activity timestamp
--
-- The admin Users list showed auth.users.last_sign_in_at as "Last seen", but
-- Supabase only updates that on an explicit SIGN-IN (password / OAuth / magic
-- link) — NOT on a session refresh. A creator who stays logged in and uses the
-- app daily keeps last_sign_in_at frozen at signup, so "Last seen" read as
-- "== Signed up" for nearly everyone. This is an actual activity timestamp,
-- stamped (throttled) whenever the signed-in creator is active in the app.
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.integrations
  add column if not exists last_seen_at timestamptz;

-- Admin list sorts / reads by recency of activity.
create index if not exists integrations_last_seen_at_idx
  on public.integrations (last_seen_at desc nulls last);
