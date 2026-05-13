-- Migration 009: Add font_theme to brand_profiles
-- Users pick one of a curated set of font pairings rendered by the theme.
-- Values: 'editorial' (default), 'modern', 'classic', 'bold', 'minimal'

alter table public.brand_profiles
  add column if not exists font_theme text not null default 'editorial';
