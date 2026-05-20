-- 043 — brand_profiles.contact_preference
--
-- Explicit channel the creator wants brands to reach them through. Used
-- by:
--   • YouTube description metadata (the "Let's Work Together" line picks
--     between website_url and contact_email based on this).
--   • Collaboration email generator (signs off / directs replies to the
--     preferred channel).
--
-- 'website' or 'email'. Defaults to 'website' to match the previous
-- implicit behavior (website-first, email fallback) for existing rows.
alter table public.brand_profiles
  add column if not exists contact_preference text
    not null default 'website'
    check (contact_preference in ('website', 'email'));
