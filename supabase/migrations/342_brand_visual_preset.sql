-- 342: the look a creator picked for their images.
--
-- A user asked whether MVP's thumbnails could be customised. They said the
-- thumbnails look good but every account produces the same ones, which was true
-- and was not a missing settings screen. The image prompt carried one hardcoded
-- aesthetic and handed it to every account on the platform: "VIRAL ... MrBeast
-- era energy ... vibrant, modern, high-contrast ... bright coloured CHECKMARKS
-- ... a vivid studio colour gradient". It asked for something UNIQUE twice while
-- specifying one look in detail, and detail wins.
--
-- This column holds the chosen look. It lives on the brand rather than on the
-- post on purpose: variety BETWEEN creators is the problem being solved, while
-- consistency WITHIN one creator is what makes a brand recognisable, and picking
-- a look per post would trade the second for the first.
--
-- Nullable, and null means the loud look every account already had. Nobody's
-- thumbnails change underneath them without being asked.
--
-- Safe to run more than once.

alter table public.brand_profiles
  add column if not exists visual_preset text;

comment on column public.brand_profiles.visual_preset is
  'Chosen image look: bold, studio, editorial, lifestyle, premium, retro, technical, handmade. See lib/visual-presets.ts. Null means the default loud look every account had before 2026-09-17.';
