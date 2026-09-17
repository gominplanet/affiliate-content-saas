-- 343: the preset list grew from eight to twenty, so the column comment that
-- names them was out of date the moment the twelve landed.
--
-- A comment that lists a subset of the real values is worse than no comment:
-- somebody reading it later concludes that 'neon' or 'blueprint' is invalid
-- data. lib/visual-presets.ts is the source of truth and the comment now says so
-- rather than trying to keep a copy of it in sync.
--
-- Safe to run more than once. Changes no data.

comment on column public.brand_profiles.visual_preset is
  'Chosen image look. Valid ids are defined in lib/visual-presets.ts (20 as of 2026-09-17, across the Loud, Quiet, Photographic and Graphic families). Null means the default loud look every account had before presets existed.';
