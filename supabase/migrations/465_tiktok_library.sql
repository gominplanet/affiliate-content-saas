-- 465: Match my TikTok (Seb, 2026-11-09: "build both, but we're going to use
-- Scout to start since I don't have the permission").
--
-- A creator's own TikTok videos, read by SCOUT from their public profile in
-- SCOUT's own window (or, once TikTok approves the scope, from TikTok's video
-- list API), and matched to the brands on TRYBE (lib/tiktok-match).
--
--   tiktok_library   one row per creator: the handle, what the profile says,
--                    the scan as it happened (read, total, reached the end or
--                    not, why it stopped), the daily check, and the matches.
--   tiktok_videos    each video read: caption, tags, date, views, cover, and
--                    any TikTok Shop product tag on it.
--
-- Written and read by the server only (no policies).
--
-- Safe to run twice.

create table if not exists public.tiktok_library (
  user_id            uuid        primary key references auth.users(id) on delete cascade,
  handle             text        not null,
  name               text,
  avatar_url         text,
  video_count        integer,
  private_account    boolean,
  scan_id            uuid,
  scan_source        text,
  scan_status        text,
  scan_read          integer     not null default 0,
  scan_total         integer,
  scan_with_product  integer     not null default 0,
  scan_reached_end   boolean,
  scan_error         text,
  scan_started_at    timestamptz,
  scan_updated_at    timestamptz,
  scan_finished_at   timestamptz,
  daily              boolean     not null default false,
  matches            jsonb       not null default '[]'::jsonb,
  matched_brands     integer     not null default 0,
  matched_at         timestamptz,
  matched_note       text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
alter table public.tiktok_library add column if not exists daily boolean not null default false;
alter table public.tiktok_library add column if not exists matched_note text;
alter table public.tiktok_library enable row level security;

create table if not exists public.tiktok_videos (
  user_id     uuid        not null references auth.users(id) on delete cascade,
  video_id    text        not null,
  handle      text        not null,
  url         text        not null,
  caption     text        not null default '',
  hashtags    text[]      not null default '{}',
  mentions    text[]      not null default '{}',
  posted_at   timestamptz,
  views       bigint,
  likes       bigint,
  cover_url   text,
  duration    integer,
  products    jsonb       not null default '[]'::jsonb,
  source      text        not null default 'scout',
  read_at     timestamptz not null default now(),
  primary key (user_id, video_id)
);
create index if not exists tiktok_videos_user_posted_idx on public.tiktok_videos (user_id, posted_at desc);
alter table public.tiktok_videos enable row level security;

notify pgrst, 'reload schema';
