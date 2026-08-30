-- 304_voice_clone.sql
-- Per-creator cloned voice for Storefront Sync dubs.
--
-- MVP's promise is content that sounds like YOU. For international dubs that
-- means the creator's OWN voice in every language, not a generic narrator. We
-- create an ElevenLabs cloned voice from the creator's existing audio (with
-- their consent) and store its id here; the dub pipeline then narrates each
-- non-English market in that voice.
--
--   eleven_voice_id          the ElevenLabs cloned-voice id (null until cloned)
--   eleven_voice_name        the sample source label, shown in the UI
--   eleven_voice_created_at  when the clone was created

alter table public.brand_profiles
  add column if not exists eleven_voice_id text,
  add column if not exists eleven_voice_name text,
  add column if not exists eleven_voice_created_at timestamptz;

notify pgrst, 'reload schema';
