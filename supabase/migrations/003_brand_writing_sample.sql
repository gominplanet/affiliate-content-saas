-- Migration 003: Add writing_sample to brand_profiles
alter table public.brand_profiles
  add column if not exists writing_sample text;
