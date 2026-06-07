-- Migration 107: User-set in-article image count on brand_profiles.
--
-- Today the per-post in-body image count is computed by allowedBlogImages
-- (lib/tier.ts) — tier ceiling scaled by word count. Many creators want
-- a fixed value: "always 2 images per post" or "0 — I don't want any".
-- This column stores their preference. Null = use the tier-scaled default
-- (backward compatible).
--
-- Range 0..4 enforced by check constraint:
--   - 0: never insert in-article images (overrides anything else)
--   - 1-4: target exactly this count (still clamped to tier ceiling
--          inside allowedBlogImages — Trial 2, Creator/Studio 3, Pro 4)

alter table public.brand_profiles
  add column if not exists blog_image_count int
    check (blog_image_count is null or (blog_image_count >= 0 and blog_image_count <= 4));
