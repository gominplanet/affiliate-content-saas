-- © 2026 Gominplanet / MVP Affiliate
--
-- Per-user toggles for the four "add-on" content blocks the blog generator
-- emits on top of the body. Lets a creator who wants a pure
-- transcript-driven narrative review opt out of the structured sections.
--
-- All four default TRUE — existing users keep current behavior. A user
-- who wants the narrative-only "video review" experience un-ticks the
-- ones they don't want. The body sections (hook → mechanics →
-- performance → friction → buyer fit → advice) are always present.
--
-- Sibling of include_improvements_section (migration 110). All five
-- toggles live on brand_profiles for the same reason: they're per-user
-- content preferences that drive what the AI emits.

alter table public.brand_profiles
  add column if not exists include_quick_verdict boolean not null default true,
  add column if not exists include_pros_cons     boolean not null default true,
  add column if not exists include_scorecard     boolean not null default true,
  add column if not exists include_faq           boolean not null default true;
