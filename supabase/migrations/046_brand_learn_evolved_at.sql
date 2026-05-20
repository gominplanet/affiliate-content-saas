-- 046 — Debounce column for the LEARN-profile auto-evolution helper
--
-- After every blog publish we may fire a Haiku call that fills empty
-- slots in the user's LEARN profile based on what they've actually
-- shipped. This column records the last time that fired so a user
-- shipping 10 posts in an hour doesn't trigger 10 evolutions — we
-- only re-run after a cool-down window (currently 6h).

alter table public.brand_profiles
  add column if not exists learn_profile_evolved_at timestamptz;
