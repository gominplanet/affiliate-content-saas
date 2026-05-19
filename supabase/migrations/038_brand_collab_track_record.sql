-- Migration 038: reusable "Track record & extras" on brand_profiles
--
-- The Collaborations page's section 3 (how many collabs done, up to 3
-- example-work links, wins/extra notes) is the same for every pitch, so
-- it should be saved once and pre-filled — not retyped each time.
-- Stored on brand_profiles (the per-user profile, like writing_sample
-- and amazon_storefront_url) and pre-filled via /api/collaborations/list.
--
-- Idempotent.

alter table public.brand_profiles
  add column if not exists collab_track_record text,
  add column if not exists collab_example_links text[] not null default '{}',
  add column if not exists collab_extra_notes  text;
