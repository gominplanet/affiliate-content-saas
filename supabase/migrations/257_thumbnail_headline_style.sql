-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 257 — Account-level thumbnail headline style
--
-- The "Question hook" thumbnail toggle is per-browser (localStorage) on the
-- interactive surfaces. But two surfaces generate thumbnails with NO interactive
-- screen — the blog featured-hero during a normal post generation, and the pins
-- made during a background Social Push. Those can't read a browser toggle, so we
-- persist the creator's choice on their account and read it server-side there.
--
-- 'statement' (default) = the polished benefit headline. 'question' = a curiosity
-- question about the product + a matching facial reaction. Set from any of the
-- interactive toggles (they now save the account default too).
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.integrations
  add column if not exists thumbnail_headline_style text not null default 'statement'
    check (thumbnail_headline_style in ('statement', 'question'));
