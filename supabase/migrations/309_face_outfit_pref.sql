-- 309 — Per-face wardrobe preference.
--
-- Creators upload headshots in a specific look (e.g. a white lab coat) and want
-- their thumbnail cut-outs to KEEP that look, but the generator randomizes the
-- outfit per thumbnail (variety), which overrode their wardrobe. This adds an
-- OPTIONAL per-face outfit the creator can set once; when present it pins the
-- wardrobe in every thumbnail / headshot cut-out for that face instead of the
-- random pool. Empty/null → behaves exactly as before (random outfit).
ALTER TABLE public.face_models
  ADD COLUMN IF NOT EXISTS outfit_pref text;

NOTIFY pgrst, 'reload schema';
