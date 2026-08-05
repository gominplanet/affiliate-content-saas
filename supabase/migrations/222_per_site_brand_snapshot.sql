-- 222 — per-blog identity: store each blog's FULL brand + Customize set
--
-- Companion to 221. Where 221 gave each site its own Customize Blog set, this
-- lets each blog carry its ENTIRE identity — brand name, tagline, colors, fonts,
-- logo, banner, socials, About, everything on brand_profiles — so two blogs on
-- the same account can look completely different.
--
-- HOW IT WORKS (same pattern the blog switcher already uses for WP creds)
--   - brand_profiles + integrations.blog_customizations always hold the ACTIVE
--     blog's identity (every reader in the app already reads those).
--   - Each blog's full copy is snapshotted onto its wordpress_sites row
--     (brand_snapshot + blog_customizations).
--   - Switching blogs snapshots the outgoing blog and restores the incoming one
--     into brand_profiles/integrations, so the whole app follows the active blog
--     without any reader needing to know about multi-site.
--
-- Backfill seeds every site with a copy of the current identity, so each blog
-- starts where it is today and then diverges independently. Guarded on "is
-- null" so re-running never clobbers a blog the user has since customized.

alter table public.wordpress_sites
  add column if not exists brand_snapshot jsonb;

comment on column public.wordpress_sites.brand_snapshot is
  'Per-blog copy of brand_profiles (name, tagline, colors, fonts, logo, banner, '
  'socials, About…), minus id/user_id/timestamps. Restored into brand_profiles '
  'when this blog becomes active. NULL = inherit the current identity until set.';

-- Seed each site''s brand snapshot from the current brand_profiles row.
update public.wordpress_sites ws
set brand_snapshot = (to_jsonb(bp) - 'id' - 'user_id' - 'created_at' - 'updated_at')
from public.brand_profiles bp
where bp.user_id = ws.user_id
  and ws.brand_snapshot is null;

-- Seed each site''s Customize set from the current account-level value.
update public.wordpress_sites ws
set blog_customizations = i.blog_customizations
from public.integrations i
where i.user_id = ws.user_id
  and ws.blog_customizations is null
  and i.blog_customizations is not null;
