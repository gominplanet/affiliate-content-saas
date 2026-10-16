-- 435: the Page Reel posts itself after the Group post (Seb, 2026-10-16: "while
-- meta is processing the video.. mvp is not able to post on the facebook
-- page.. are we able to get this done in the background").
--
-- When SCOUT has filled a Group post with a clip, MVP keeps the Page Reel to
-- post here as a job with a one-time key. SCOUT keeps watching the Group in
-- the background (up to 3 hours, Facebook processes videos for a while) and,
-- when the post is up, hands MVP's server its link with that key, and the
-- server posts the Reel linking to it. MVP's tab can be closed meanwhile.
--
-- Safe to run twice.

create table if not exists public.facebook_reel_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  social_account_id text,
  clip_url text not null,
  source_video_id text,
  title text,
  group_url text,
  caption text not null default '',
  clip_seconds numeric,
  token_hash text not null,
  -- waiting | posting | posted | failed | needs_you | cancelled | expired
  status text not null default 'waiting',
  group_post_url text,
  page_post_url text,
  video_id text,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '4 hours')
);
create index if not exists facebook_reel_jobs_user_idx on public.facebook_reel_jobs (user_id, created_at desc);
create index if not exists facebook_reel_jobs_clip_idx on public.facebook_reel_jobs (user_id, clip_url, created_at desc);
-- Written and read by MVP's server only (service role).
alter table public.facebook_reel_jobs enable row level security;
