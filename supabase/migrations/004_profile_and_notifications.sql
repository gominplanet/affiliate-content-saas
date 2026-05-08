-- Migration 004: Profile fields + notification preferences
-- Apply with: run in Supabase SQL editor

-- Add author bio, logo, headshot to brand_profiles
alter table public.brand_profiles
  add column if not exists author_bio       text,
  add column if not exists logo_url         text,
  add column if not exists headshot_url     text;

-- Add notification preferences to integrations
alter table public.integrations
  add column if not exists notification_preferences jsonb not null default '{
    "new_video": true,
    "post_published": true,
    "job_failures": true,
    "weekly_digest": false
  }';
