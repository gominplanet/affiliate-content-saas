-- Migration 093: blog_posts.deal_meta JSONB column
--
-- Powers the new Deals Hub (post_type='deal'). Holds the structured deal
-- envelope: asin, prices (was/sale), discount percent, deal badge text, end
-- date, occasion slug, promo code, promo URL, plus the rendered badge label
-- and the savings line we computed for the article body.
--
-- JSONB chosen over per-column columns because:
--   1. Schema is deal-specific — bloating blog_posts with 10+ NULL columns
--      that only deal rows ever populate is noisy.
--   2. JSONB lets the WP plugin's [mvp_deal_banner] shortcode read whatever
--      structured fields we end up needing without another migration.
--   3. The API route always reads the whole object together, never queries
--      by individual fields.
--
-- Indexed only on a single GIN to keep writes cheap; the Deals Hub list query
-- filters by user_id + post_type='deal' which already hits the primary
-- composite index from migration 068.

alter table public.blog_posts
  add column if not exists deal_meta jsonb;

comment on column public.blog_posts.deal_meta is
  'Structured deal envelope for post_type=''deal'' rows (Deals Hub). NULL for review/comparison/guide rows.';

-- Light GIN index so future analytics queries (e.g. "all Black Friday deals
-- ending this week") stay fast. The deals UI itself doesn't need this.
create index if not exists blog_posts_deal_meta_gin
  on public.blog_posts using gin (deal_meta)
  where deal_meta is not null;
