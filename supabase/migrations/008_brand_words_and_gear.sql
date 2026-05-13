-- Migration 008: Add missing brand_profiles columns used by the Brand Profile UI
-- The frontend has fields for "Words & Phrases to Avoid" and "YouTube Description
-- Sections" but the columns were never created, so every save silently failed.

alter table public.brand_profiles
  add column if not exists words_to_avoid text,
  add column if not exists gear_sections  jsonb not null default '[]'::jsonb;
