-- 081 — TikTok integration (Content Posting API + Login Kit)
--
-- MVP creators connect their TikTok account via TikTok's Login Kit (OAuth)
-- and we use the Content Posting API's Direct Post path to publish vertical
-- shorts on their behalf. Scopes: user.info.basic, video.upload,
-- video.publish.
--
-- Token shape:
--   * access token   — 24 hours
--   * refresh token  — 365 days (issued on the initial code exchange,
--     usable to mint a new access token without re-prompting the creator)
--
-- We track per-post publish state on blog_posts so the Content page can
-- show a "Posted to TikTok" pill + open-in-TikTok link once it's live.
-- TikTok takes minutes to process even after `init` returns 200; we surface
-- the polling state via `tiktok_publish_status` so the UI can show
-- "Processing" instead of pretending the post is live.

-- ── Creator OAuth tokens + identity ────────────────────────────────────────
alter table public.integrations
  -- Stable internal ID TikTok hands us once OAuth completes. Persists across
  -- token refreshes; use this to scope the post-history join in case the
  -- creator changes their @username.
  add column if not exists tiktok_open_id            text,
  -- Human-readable handle. Cached at OAuth-time and refreshed on each
  -- creator_info query so the dashboard never shows a stale @.
  add column if not exists tiktok_username           text,
  add column if not exists tiktok_display_name       text,
  add column if not exists tiktok_avatar_url         text,
  add column if not exists tiktok_access_token       text,
  add column if not exists tiktok_refresh_token      text,
  -- Epoch millis. We refresh 60s before expiry to avoid a race where the
  -- API call goes out with a token that's *just* expired.
  add column if not exists tiktok_token_expiry       bigint,
  -- When the refresh token itself expires (365 days from connect). After
  -- this the creator has to reconnect — we surface a banner in advance.
  add column if not exists tiktok_refresh_expiry     bigint,
  -- Which scopes the creator actually granted. Cached so the publish route
  -- can fail fast with "reconnect to grant video.publish" instead of a
  -- vague 403 from TikTok's API.
  add column if not exists tiktok_scopes             text;

-- ── Per-post publish tracking ──────────────────────────────────────────────
alter table public.blog_posts
  -- `publish_id` returned by /v2/post/publish/video/init. Used to poll the
  -- /status/fetch endpoint until TikTok finishes processing the video.
  add column if not exists tiktok_publish_id         text,
  -- 'processing' | 'published' | 'failed'. Mirrors TikTok's status with
  -- a small allowlist — the raw status strings (PROCESSING_UPLOAD,
  -- PUBLISH_COMPLETE, etc.) are useful for debugging but we only render
  -- these three to the dashboard.
  add column if not exists tiktok_publish_status     text,
  -- The public TikTok URL once the video is live. Null while processing.
  add column if not exists tiktok_share_url          text,
  -- Last-error message from TikTok when the publish fails (e.g. duration
  -- too long, watermark detected, account suspended). Surfaced to the
  -- creator in the dashboard so they don't have to guess.
  add column if not exists tiktok_error_message      text,
  -- Stamped when we get the first PUBLISH_COMPLETE poll. Used for the
  -- "Posted X min ago" pill on the Content page.
  add column if not exists tiktok_posted_at          timestamptz;

-- Newest-published lookup for the "Recent TikTok posts" section on the
-- dashboard. Tiny index — only matters when the dashboard surfaces a
-- "what's been pushed to TikTok this week" widget later.
create index if not exists blog_posts_tiktok_posted_idx
  on public.blog_posts (user_id, tiktok_posted_at desc)
  where tiktok_posted_at is not null;
