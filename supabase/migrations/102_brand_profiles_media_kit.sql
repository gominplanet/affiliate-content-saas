-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 102 — Add media_kit_url to brand_profiles.
--
-- We started recommending Oink's free media kit template on /collaborations
-- on 2026-06-05. Brands almost always ask for a media kit before agreeing to
-- a deal, so the pitch email should include the user's media kit URL — but
-- there was nowhere to store it.
--
-- This column is the "set once on Brand Profile, attached to every pitch
-- email" anchor. The collab form pre-fills from this column and lets users
-- override per-pitch; the email-generator weaves the link into the sign-off
-- block alongside the website / Linktree / contact channels.
--
-- Idempotent (IF NOT EXISTS guard). No backfill needed — empty string means
-- "user hasn't made one yet" and the email simply skips the line.
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.brand_profiles
  add column if not exists media_kit_url text;

comment on column public.brand_profiles.media_kit_url is
  'Public URL of the creator''s media kit (typically a hosted PDF or a '
  'shared Notion/Google Doc/Canva link). Surfaced on /collaborations as a '
  'pre-fillable field; threaded into generated pitch emails so brands can '
  'click straight to the kit. Empty string = no kit yet (the email omits '
  'the line gracefully). See lib/collab.ts for the prompt threading.';
