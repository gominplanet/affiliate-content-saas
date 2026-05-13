-- Migration 010: Add all social-link + contact columns to brand_profiles
-- These are now the single source of truth (previously stored in blog_customizations).
-- All idempotent so safe to re-run.

alter table public.brand_profiles
  add column if not exists contact_email      text,
  add column if not exists youtube_channel_url text,
  add column if not exists instagram_url       text,
  add column if not exists tiktok_url          text,
  add column if not exists twitter_url         text,
  add column if not exists pinterest_url       text,
  add column if not exists facebook_url        text,
  add column if not exists threads_url         text;
