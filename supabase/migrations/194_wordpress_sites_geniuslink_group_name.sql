-- 194 — Let creators NAME their own Geniuslink group per blog.
--
-- Sibling of wordpress_sites.geniuslink_group_id (migration 112, the cached
-- numeric id). When set, this custom name is used to find-or-create the site's
-- Geniuslink group instead of the auto-derived domain name — so a creator who
-- already keeps a specific group per blog can point MVP at it by name.
-- NULL/empty → fall back to the domain-derived name (unchanged behavior).
ALTER TABLE wordpress_sites
  ADD COLUMN IF NOT EXISTS geniuslink_group_name text;

NOTIFY pgrst, 'reload schema';
