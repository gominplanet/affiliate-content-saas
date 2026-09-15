-- 333 — An ACCOUNT-LEVEL default for where links send people.
--
-- Migration 332 gave each post a toggle. That serves a creator who occasionally
-- posts to TikTok. It does not serve a creator who SELLS on TikTok: they would
-- have to tick a box on every post, on every surface, forever, and the first
-- one they forget silently publishes an Amazon link.
--
-- So the default moves to the account, and the per-post toggle becomes the
-- exception rather than the rule. A TikTok-first creator sets this once and
-- every surface inherits it: blog posts, comparisons, buying guides, campaigns,
-- Link in Bio tiles, the weekly digest, DMs, pins, and everything added later.
--
-- 'amazon' is the default and the behaviour every existing account keeps. A row
-- with NULL here is an account that has never chosen, which reads as 'amazon'.
--
-- Safe to run twice.

alter table public.integrations
  add column if not exists link_destination_default text;

comment on column public.integrations.link_destination_default is
  'Where this creator''s links send people by default: ''amazon'' (or NULL, the same thing) or ''showcase'' for their TikTok Shop. A post can override it either way. Requires tiktok_showcase_url (migration 332) to take effect; without one, every surface falls back to Amazon and says so.';

-- A showcase default with nothing to point at is the one state that would fail
-- silently on every post at once, so it is worth being able to find.
create index if not exists integrations_showcase_default_idx
  on public.integrations (user_id)
  where link_destination_default = 'showcase';
