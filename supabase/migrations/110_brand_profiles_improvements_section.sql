-- © 2026 Gominplanet / MVP Affiliate
--
-- Per-user toggle for the "What we'd improve" section in generated blog
-- posts. When ON, the AI adds a Wirecutter-style "Flaws but not deal
-- breakers" block between the body and FAQ — manufacturer-facing
-- critique distinct from the consumer-facing Cons list. Adds editorial
-- credibility but reads more critical, so it's opt-in per user.
--
-- Defaults to FALSE — existing posts and brand profiles are unaffected
-- until the user opts in via Brand Profile.

alter table public.brand_profiles
  add column if not exists include_improvements_section boolean not null default false;
