-- ============================================================
-- AffiliateOS — Supabase Database Schema
-- ============================================================
-- Run order: this file is idempotent (safe to re-run)
-- Enable RLS on every table; all access is user-scoped.
-- ============================================================

-- Extensions
create extension if not exists "pgcrypto";

-- ============================================================
-- 1. PROFILES
-- Mirrors auth.users — created automatically via trigger.
-- ============================================================
create table if not exists public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  email       text not null,
  full_name   text,
  avatar_url  text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

alter table public.profiles enable row level security;

create policy "Users can view own profile"
  on public.profiles for select
  using (auth.uid() = id);

create policy "Users can update own profile"
  on public.profiles for update
  using (auth.uid() = id);

-- Auto-create profile on signup
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer as $$
begin
  insert into public.profiles (id, email, full_name)
  values (
    new.id,
    new.email,
    new.raw_user_meta_data->>'full_name'
  );
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ============================================================
-- 2. BRAND PROFILES
-- One brand profile per user (unique constraint).
-- ============================================================
create table if not exists public.brand_profiles (
  id                   uuid primary key default gen_random_uuid(),
  user_id              uuid not null references public.profiles(id) on delete cascade,
  name                 text not null default '',
  tagline              text,
  author_name          text,
  website_url          text,
  niches               text[] not null default '{}',
  target_audience      text,
  audience_pain_points text,
  awareness_level      text check (awareness_level in ('problem-aware','solution-aware','product-aware','most-aware')),
  tone                 text[] not null default '{}',
  post_length          text not null default 'medium',
  cta_style            text not null default 'soft_recommendation',
  affiliate_disclaimer text,
  primary_color        text,
  secondary_color      text,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  unique (user_id)
);

alter table public.brand_profiles enable row level security;

create policy "Users can manage own brand profile"
  on public.brand_profiles for all
  using (auth.uid() = user_id);

-- ============================================================
-- 3. INTEGRATIONS
-- Encrypted API keys per user. One row per user.
-- Keys are encrypted at the application layer before storage.
-- ============================================================
create table if not exists public.integrations (
  id                      uuid primary key default gen_random_uuid(),
  user_id                 uuid not null references public.profiles(id) on delete cascade,
  youtube_api_key         text,
  youtube_channel_id      text,
  wordpress_url           text,
  wordpress_username      text,
  wordpress_app_password  text,    -- store encrypted
  hostinger_api_key       text,    -- store encrypted
  anthropic_api_key       text,    -- store encrypted
  gemini_api_key          text,    -- store encrypted
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  unique (user_id)
);

alter table public.integrations enable row level security;

create policy "Users can manage own integrations"
  on public.integrations for all
  using (auth.uid() = user_id);

-- ============================================================
-- 4. YOUTUBE VIDEOS
-- Synced from YouTube Data API. One row per video per user.
-- ============================================================
create table if not exists public.youtube_videos (
  id                    uuid primary key default gen_random_uuid(),
  user_id               uuid not null references public.profiles(id) on delete cascade,
  youtube_video_id      text not null,
  title                 text not null,
  description           text,
  thumbnail_url         text,
  channel_id            text not null,
  channel_title         text not null,
  published_at          timestamptz not null,
  view_count            bigint,
  transcript            text,
  transcript_fetched_at timestamptz,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  unique (user_id, youtube_video_id)
);

create index if not exists idx_youtube_videos_user_published
  on public.youtube_videos (user_id, published_at desc);

alter table public.youtube_videos enable row level security;

create policy "Users can manage own videos"
  on public.youtube_videos for all
  using (auth.uid() = user_id);

-- ============================================================
-- 5. BLOG POSTS
-- Generated blog content, linked 1:1 to a YouTube video.
-- ============================================================
create table if not exists public.blog_posts (
  id                       uuid primary key default gen_random_uuid(),
  user_id                  uuid not null references public.profiles(id) on delete cascade,
  video_id                 uuid not null references public.youtube_videos(id) on delete cascade,
  title                    text not null,
  slug                     text not null,
  content                  text,
  excerpt                  text,
  seo_meta_description     text,
  affiliate_keywords       text[],
  status                   text not null default 'pending'
                             check (status in ('pending','draft','published','failed')),
  wordpress_post_id        integer,
  wordpress_url            text,
  ai_model                 text,
  generation_prompt_version text,
  published_at             timestamptz,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  unique (user_id, video_id)
);

create index if not exists idx_blog_posts_user_status
  on public.blog_posts (user_id, status);

alter table public.blog_posts enable row level security;

create policy "Users can manage own blog posts"
  on public.blog_posts for all
  using (auth.uid() = user_id);

-- ============================================================
-- 6. SOCIAL DRAFTS
-- Multiple drafts per video (one per platform).
-- ============================================================
create table if not exists public.social_drafts (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references public.profiles(id) on delete cascade,
  video_id       uuid not null references public.youtube_videos(id) on delete cascade,
  blog_post_id   uuid references public.blog_posts(id) on delete set null,
  platform       text not null check (platform in ('twitter','linkedin','instagram')),
  content        text not null,
  char_count     integer not null,
  status         text not null default 'pending'
                   check (status in ('pending','approved','rejected','published')),
  approved_at    timestamptz,
  published_at   timestamptz,
  ai_model       text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index if not exists idx_social_drafts_user_status
  on public.social_drafts (user_id, status);

create index if not exists idx_social_drafts_video
  on public.social_drafts (video_id);

alter table public.social_drafts enable row level security;

create policy "Users can manage own social drafts"
  on public.social_drafts for all
  using (auth.uid() = user_id);

-- ============================================================
-- 7. JOB FAILURES
-- Tracks all failed background jobs for the admin panel.
-- ============================================================
create table if not exists public.job_failures (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references public.profiles(id) on delete cascade,
  job_type      text not null
                  check (job_type in ('blog_generation','wp_publish','social_draft','youtube_sync')),
  video_id      uuid references public.youtube_videos(id) on delete set null,
  error_message text not null,
  error_code    text,
  stack_trace   text,
  retry_count   integer not null default 0,
  status        text not null default 'pending_retry'
                  check (status in ('pending_retry','retrying','resolved','dismissed')),
  resolved_at   timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists idx_job_failures_user_status
  on public.job_failures (user_id, status, created_at desc);

alter table public.job_failures enable row level security;

create policy "Users can manage own job failures"
  on public.job_failures for all
  using (auth.uid() = user_id);

-- ============================================================
-- 8. updated_at TRIGGER (shared)
-- ============================================================
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

do $$ declare
  t text;
begin
  foreach t in array array[
    'profiles','brand_profiles','integrations',
    'youtube_videos','blog_posts','social_drafts','job_failures'
  ] loop
    execute format('
      drop trigger if exists set_updated_at on public.%I;
      create trigger set_updated_at
        before update on public.%I
        for each row execute function public.set_updated_at();
    ', t, t);
  end loop;
end $$;
