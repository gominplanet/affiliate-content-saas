-- © 2026 Gominplanet / MVP Affiliate
--
-- Migration 120 — post_seo.best_position (ranking-decay detection, epic #249).
--
-- post_seo already caches each post's CURRENT GSC position, and 071 added
-- dropped_at for DE-INDEXING. Neither captures RANKING decay — a post that's
-- still indexed but has slipped (peaked at #3, now sits at #14). That's a real,
-- recoverable revenue leak (a refresh often pulls it back toward page 1).
--
-- These two columns track the all-time PEAK (lowest) average position a post has
-- reached. /api/seo/opportunities updates best_position whenever the live GSC
-- position beats it, and the classifier (lib/post-opportunity.ts) flags a
-- 'decaying' opportunity when a post that peaked on page 1 has since slipped.
-- No cron / time-series table needed — the peak accrues across /seo loads.
--
--   best_position     — lowest avg position ever recorded (1 = top of results)
--   best_position_at  — when that peak was last (re)set
--
-- Both nullable; absence = "no history yet" → decay simply doesn't fire until a
-- peak has been observed. The opportunities route catches the missing-column
-- error, so deploying the code before this migration runs is a safe no-op.

alter table public.post_seo
  add column if not exists best_position real,
  add column if not exists best_position_at timestamptz;

comment on column public.post_seo.best_position is
  'All-time best (lowest) average GSC position this post has reached. Updated by /api/seo/opportunities; drives ranking-decay detection in lib/post-opportunity.ts.';
