-- 239 — Face model "optimized" (beautified) photo set + selection toggle.
--
-- A face model is a saved set of the creator's selfies (source_images), used
-- directly as gpt-image identity references. This adds an OPTIONAL second set:
-- a light, identity-preserving retouch of each selfie (better lighting,
-- sharpness, minor skin cleanup, tidy background). The creator picks which set
-- content generation uses via use_optimized.
--
-- Everything is additive and defaulted so existing rows keep working unchanged:
-- optimized_images empty, optimized_status 'none', use_optimized false → behaves
-- exactly as before (uses source_images).

ALTER TABLE public.face_models
  ADD COLUMN IF NOT EXISTS optimized_images jsonb NOT NULL DEFAULT '[]'::jsonb,
  -- Lifecycle of the beautify pass:
  --   none        — never run (only source_images exist)
  --   processing  — retouch job in flight
  --   ready       — optimized_images populated, selectable
  --   failed      — retouch errored; optimize_error carries the message
  ADD COLUMN IF NOT EXISTS optimized_status text NOT NULL DEFAULT 'none'
    CHECK (optimized_status IN ('none', 'processing', 'ready', 'failed')),
  -- Which set generation uses. Only meaningful when optimized_status='ready'.
  ADD COLUMN IF NOT EXISTS use_optimized boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS optimize_error text;

NOTIFY pgrst, 'reload schema';
