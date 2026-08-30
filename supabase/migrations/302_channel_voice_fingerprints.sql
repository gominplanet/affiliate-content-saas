-- 302_channel_voice_fingerprints.sql
-- Per-channel voice fingerprints.
--
-- A creator with more than one connected YouTube channel usually sounds
-- different on each (a calm tech channel, a hyped gaming channel). The single
-- voice_fingerprint (301) is their overall voice and stays the default/fallback;
-- this adds a per-channel map so content made from a given channel's videos can
-- sound like THAT channel.
--
-- Shape: { "<youtube channel id>": { "text": "...", "updated_at": "...",
--          "sources": 3, "seen": ["<video id>", ...] } }
-- Kept as one jsonb map (not a table) because it's small, per-user, and already
-- covered by brand_profiles' row-level security. Resolution: use the channel's
-- entry when present, else fall back to voice_fingerprint.

alter table public.brand_profiles
  add column if not exists channel_voice_fingerprints jsonb not null default '{}'::jsonb;
