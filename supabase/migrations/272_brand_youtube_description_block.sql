-- 272 — Creator-managed custom block for YouTube descriptions.
--
-- A free-text block the creator writes once in Brand Profile. Co-Pilot appends
-- it verbatim (spacing, blank lines and emojis preserved) to EVERY YouTube
-- description it generates — for their socials, standard CTAs, discount codes,
-- or anything else they want on all their videos. Distinct from gear_sections
-- (structured name→link rows); this is a plain block they format themselves.
-- Idempotent.

alter table public.brand_profiles
  add column if not exists youtube_description_block text;

notify pgrst, 'reload schema';
