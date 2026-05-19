-- Migration 035: brand_profiles.learn_profile
--
-- The new LEARN page captures structured voice-training input the blog
-- agents read on every generation: 6 free-text "voice calibration"
-- answers, 7 either/or communicative-style choices, and two checkbox
-- groups (natural speech patterns, thought process).
--
-- Stored as a single jsonb blob so the question set can evolve without
-- a migration per question. The existing free-text columns
-- (writing_sample, author_bio, target_audience, words_to_avoid) are
-- kept as-is — their values carry over; the LEARN page just becomes
-- the single editing surface for them.
--
-- Shape:
-- {
--   "voice": { "sounds_fake": "", "sounds_intelligent": "", "sounds_weak": "",
--              "sounds_cringe": "", "sounds_trustworthy": "", "stops_reading": "" },
--   "style": { "blunt_diplomatic": "blunt"|"diplomatic"|null, ... 7 keys },
--   "speech_patterns": ["rhetorical_questions", ...],
--   "thought_process": ["start_with_story", ...]
-- }
--
-- Idempotent.

alter table public.brand_profiles
  add column if not exists learn_profile jsonb not null default '{}'::jsonb;
