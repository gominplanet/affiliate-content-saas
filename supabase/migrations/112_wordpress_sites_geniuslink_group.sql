-- © 2026 Gominplanet / MVP Affiliate
--
-- Per-site Geniuslink group cache.
--
-- We auto-resolve (and auto-create when missing) a Geniuslink group named
-- after the site domain so the user can see clicks segmented by blog in
-- their Geniuslink dashboard. Resolving costs at least one API call
-- (list-groups), so we cache the resolved ID on the wordpress_sites row.
--
-- NULL = not yet resolved. First link generation for the site resolves it
-- and writes back. Users can clear the column to force re-resolution
-- (e.g. after they delete + recreate the group on Geniuslink's side).
--
-- Sibling of the per-user `geniuslink_api_key` / `geniuslink_api_secret`
-- on the integrations table; lives on wordpress_sites because grouping is
-- a per-site concern, not a per-account concern.

alter table public.wordpress_sites
  add column if not exists geniuslink_group_id integer;

comment on column public.wordpress_sites.geniuslink_group_id is
  'Geniuslink group ID this site''s links route to. Resolved lazily by name (the site domain) on first use; cached here so subsequent generations skip the list-groups round-trip. NULL = unresolved.';
