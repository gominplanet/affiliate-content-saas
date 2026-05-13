-- Add headshot_urls array to brand_profiles for multi-headshot thumbnail generation
alter table public.brand_profiles
  add column if not exists headshot_urls text[] default '{}';
