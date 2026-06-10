-- 122 — Saved thumbnail BRAND STYLE (one per creator)
--
-- A creator's locked thumbnail look, so a whole channel reads consistently:
--   - borderStyleIndex : which neon border (0-9), or null = keep borders varied
--   - accentColor      : the title emphasis colour (hex), default #FFE034 (yellow)
--   - faceModelId      : pin a specific face_models.id, or null = auto-match
--
-- DISTINCT from thumbnail_styles (migration 072), which is a LIBRARY of reference
-- IMAGES that flavor the AI-generated SCENE. The brand style locks the OVERLAY
-- identity (frame + title colour + face). One per user → a column on
-- brand_profiles rather than its own table. null = no preset (Explore mode).

alter table public.brand_profiles
  add column if not exists thumbnail_brand_style jsonb;

comment on column public.brand_profiles.thumbnail_brand_style is
  'Saved thumbnail brand preset: { borderStyleIndex: int 0-9 | null, accentColor: hex string, faceModelId: uuid | null }. null = no preset (Explore mode).';
