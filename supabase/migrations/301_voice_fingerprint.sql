-- 301_voice_fingerprint.sql
-- Continually-learned voice fingerprint.
--
-- Alongside the manual Voice Training (learn_profile) and the one-time
-- gap-filler (learn-evolve), MVP now keeps a persistent, ever-refining
-- description of how a creator actually sounds, learned primarily from their
-- own YouTube transcripts (spoken voice = truest signal) plus their published
-- posts. It is refined incrementally: each run folds in the videos it hasn't
-- seen yet, so it gets richer the more the creator feeds it. Never overwrites
-- the manual profile — it is additive context injected into every writer prompt.
--
--   voice_fingerprint            the rich, plain-text style profile the writers read
--   voice_fingerprint_updated_at last refinement time (also the debounce clock)
--   voice_fingerprint_sources    how many videos + posts it has learned from (shown in the UI)
--   voice_fingerprint_seen       ids of the sources already folded in (so each run only adds new ones)

alter table public.brand_profiles
  add column if not exists voice_fingerprint text,
  add column if not exists voice_fingerprint_updated_at timestamptz,
  add column if not exists voice_fingerprint_sources integer not null default 0,
  add column if not exists voice_fingerprint_seen jsonb not null default '[]'::jsonb;
