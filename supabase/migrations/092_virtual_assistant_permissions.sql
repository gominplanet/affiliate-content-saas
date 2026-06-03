-- 092 — Virtual Assistant permissions on agency invites + members
--
-- Phase 1 (migration 089) shipped invites + roster with two roles:
-- 'admin' and 'member'. Both roles got the same broad access — fine for
-- a trusted in-house teammate, too much for an outsourced VA the user
-- wants doing a specific task (e.g. only generating posts, only
-- publishing to socials).
--
-- This migration adds granular permission flags so the owner can
-- create scoped VAs while keeping the role concept for the few things
-- it still controls (admin = can manage other VAs; member = can't).
--
-- The blocked-for-VAs surfaces (blog customization, integrations, WP
-- settings, brand profile, billing) are enforced at the route layer
-- via hasPermission() / BLOCKED_FOR_VAS — there's no per-VA flag for
-- those because they're never legitimate VA work.
--
-- Permission schema (JSONB):
--   {
--     "generate_posts":         bool,   -- can use /content + /api/blog/generate
--     "publish_to_socials":     bool,   -- can post to FB/IG/TikTok/Threads/X/Pinterest
--     "manage_newsletter":      bool,   -- can compose + send newsletters
--     "youtube_copilot":        bool,   -- can generate YT metadata + thumbnails
--     "manage_videos":          bool,   -- can add/remove videos from the library
--     "view_analytics":         bool    -- can see Analytics + SEO + content insights
--   }
--
-- All flags default to true on existing members (preserve current behavior)
-- and to a sensible "content VA" preset on new invites.

alter table public.agency_invites
  add column if not exists permissions jsonb not null default jsonb_build_object(
    'generate_posts',     true,
    'publish_to_socials', true,
    'manage_newsletter',  false,
    'youtube_copilot',    true,
    'manage_videos',      true,
    'view_analytics',     false
  );

alter table public.agency_members
  add column if not exists permissions jsonb not null default jsonb_build_object(
    'generate_posts',     true,
    'publish_to_socials', true,
    'manage_newsletter',  true,
    'youtube_copilot',    true,
    'manage_videos',      true,
    'view_analytics',     true
  );

-- Backfill: any existing accepted members get the full permission set
-- (matches the pre-permissions behavior where every member had broad
-- access). Owners can downscope from the UI afterwards.
update public.agency_members
set permissions = jsonb_build_object(
    'generate_posts',     true,
    'publish_to_socials', true,
    'manage_newsletter',  true,
    'youtube_copilot',    true,
    'manage_videos',      true,
    'view_analytics',     true
  )
where permissions is null or permissions = '{}'::jsonb;
