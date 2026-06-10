-- © 2026 Gominplanet / MVP Affiliate
--
-- Migration 117 — edit-feedback distillation cache (blog writer Sprint 3).
--
-- Every "Rewrite" note a creator types is stored on
-- blog_posts.last_rewrite_feedback. Generation pulls the recent ones and
-- injects them RAW. lib/feedback-distill.ts adds a post-publish, debounced
-- step that collapses those raw notes into a deduplicated, weighted set of
-- standing rules and caches the result here — so the distillation cost is
-- paid once, not on every generation, and generation reads the clean cached
-- rules instead of 8 redundant raw lines.
--
--   distilled_feedback      — the cached bulleted rule set (plain text)
--   distilled_feedback_at   — last distillation timestamp (debounce; 6h)
--
-- Both nullable; absence = "never distilled yet" → generation falls back to
-- the raw notes. lib/feedback-distill.ts catches the missing-column error,
-- so deploying the code before this migration runs is a safe no-op.

alter table public.brand_profiles
  add column if not exists distilled_feedback text,
  add column if not exists distilled_feedback_at timestamptz;

comment on column public.brand_profiles.distilled_feedback is
  'Deduplicated, weighted set of standing edit rules distilled from the user''s accumulated last_rewrite_feedback notes. Injected into blog generation. Refreshed post-publish (debounced 6h) by lib/feedback-distill.ts.';
