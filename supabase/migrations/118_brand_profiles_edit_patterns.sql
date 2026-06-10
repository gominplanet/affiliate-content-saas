-- © 2026 Gominplanet / MVP Affiliate
--
-- Migration 118 — implicit edit-pattern learning (blog writer Sprint 3 Part 2).
--
-- Migration 117 (feedback distillation) learns from the EXPLICIT "Rewrite"
-- notes a creator types. This learns from the IMPLICIT signal that's far
-- richer and never volunteered: the difference between the AI draft we stored
-- (blog_posts.content) and the version the creator actually published + edited
-- on WordPress.
--
-- lib/edit-learning.ts fetches the live WP content for the creator's recent
-- posts, diffs it against our stored draft, and — when enough posts show real
-- human edits — Haiku-distills the recurring changes ("always tightens the
-- opening", "cuts superlatives", "adds a personal anecdote about setup") into a
-- standing rule set cached here and injected into every future generation,
-- alongside the explicit distilled_feedback.
--
--   edit_pattern_feedback     — cached bulleted rule set (plain text)
--   edit_pattern_feedback_at  — last run timestamp (debounce; 24h)
--
-- Both nullable; absence = "never learned yet" → generation simply doesn't
-- inject edit-pattern rules. lib/edit-learning.ts catches the missing-column
-- error, so deploying the code before this migration runs is a safe no-op.

alter table public.brand_profiles
  add column if not exists edit_pattern_feedback text,
  add column if not exists edit_pattern_feedback_at timestamptz;

comment on column public.brand_profiles.edit_pattern_feedback is
  'Distilled standing rules learned from the diff between AI drafts and the creator''s published/edited WordPress versions. Injected into blog generation alongside distilled_feedback. Refreshed post-publish (debounced 24h) by lib/edit-learning.ts.';
