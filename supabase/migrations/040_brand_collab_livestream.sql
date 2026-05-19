-- Migration 040: reusable livestream offer on brand_profiles
--
-- "Open to live streams?" + the creator's best livestream link are the
-- same for every pitch, so persist them on the per-user profile (like
-- collab_track_record) and pre-fill the Collaborations form instead of
-- retyping each time.
--
-- Idempotent.

alter table public.brand_profiles
  add column if not exists collab_livestreams     boolean not null default false,
  add column if not exists collab_livestream_link text;
