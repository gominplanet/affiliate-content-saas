-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 258 — Explicit Pinterest board target (board picker)
--
-- Until now MVP either auto-created a board per blog category, or fell back to
-- the board frozen at connect time (integrations.pinterest_board_id — often a
-- stale sandbox board). Creators had no way to CHOOSE where pins land.
--
-- pinterest_pin_target is the creator's explicit choice from the board picker:
--   NULL  → organize by category (a board per category), the current default.
--   <id>  → send every pin to this specific board.
-- It's separate from the legacy pinterest_board_id so a deliberate pick is never
-- confused with the auto-frozen board.
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.integrations
  add column if not exists pinterest_pin_target text;
