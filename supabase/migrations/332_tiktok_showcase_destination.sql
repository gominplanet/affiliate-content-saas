-- 332 — Send a post's clicks to the creator's TikTok Shop showcase instead of
-- to Amazon.
--
-- This is a DESTINATION, not a fifth link style: the cloaking layer
-- (Passport / Geniuslink / Bitly / direct) is unchanged and still wraps
-- whatever it is handed. See lib/post-destination for why the ASIN must NOT be
-- passed to the cloaker on a showcase post, and why Geniuslink is excluded.
--
-- Two places to store:
--   1. the saved default, so it is typed once            → integrations
--   2. what a given post actually chose, so a scheduled  → the queue tables
--      post fires with the destination it was queued with
--
-- Safe to run twice.

-- ── 1. The saved default ────────────────────────────────────────────────────
alter table public.integrations
  add column if not exists tiktok_showcase_url text;

comment on column public.integrations.tiktok_showcase_url is
  'Default TikTok Shop showcase link. Used when a post turns the showcase toggle on and does not paste its own. Validated as a tiktok.com https URL before use (lib/post-destination).';

-- ── 2. What each queued post chose ──────────────────────────────────────────
-- Resolved AT SCHEDULING TIME and stored, not re-resolved when the post fires.
-- The composer told the creator where the link would go; changing the saved
-- default afterwards must not silently redirect a post they already approved.
alter table public.deal_scheduled_posts
  add column if not exists destination_url text;
alter table public.deal_scheduled_posts
  add column if not exists destination_kind text;

alter table public.amazon_scheduled_posts
  add column if not exists destination_url text;
alter table public.amazon_scheduled_posts
  add column if not exists destination_kind text;

-- ── 3. What a published blog post used ──────────────────────────────────────
-- So the link-repair tools can tell "this post deliberately points at a
-- showcase" apart from "this post's affiliate link is broken". Without it, a
-- showcase post reads as a post with no recognisable affiliate style and the
-- repair tool would offer to rewrite it back to Amazon.
alter table public.blog_posts
  add column if not exists destination_kind text;
alter table public.blog_posts
  add column if not exists destination_url text;

create index if not exists blog_posts_destination_kind_idx
  on public.blog_posts (user_id, destination_kind)
  where destination_kind is not null;
