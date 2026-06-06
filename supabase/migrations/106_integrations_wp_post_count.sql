-- Migration 106: Cached WordPress post count on integrations.
--
-- The dashboard layout used to fetch
-- ${wpSiteUrl}/wp-json/wp/v2/posts?per_page=1 on EVERY non-admin nav
-- to gate the Buying Guides feature (500-post threshold). That hit
-- WordPress on every page transition — 300ms-2.5s per nav, with the
-- whole layout blocked behind it on slow hosts.
--
-- Now the layout reads the cached count from this column. A nightly
-- cron (/api/cron/refresh-wp-post-counts) updates every active user's
-- count by polling each connected WP site. Big perceived-perf win;
-- saves ~500-2500ms per dashboard route change.
--
-- updated_at lets the layout fall back to a live fetch if the cache
-- is stale (>24h old) — keeps the gate working even when the cron
-- hasn't run yet (e.g. brand new user, first dashboard load).

alter table public.integrations
  add column if not exists wp_post_count int;

alter table public.integrations
  add column if not exists wp_post_count_updated_at timestamptz;
