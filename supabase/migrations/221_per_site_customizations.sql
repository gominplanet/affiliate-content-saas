-- 221 — per-site Customize Blog (Phase 3 of the multi-site rollout)
--
-- Each connected blog gets its OWN identity + Customize Blog set, instead of one
-- account-wide value shared by every site. This is what lets a user run a
-- remote-control-car blog and a vacuum blog off the same account with different
-- banners, logos, Pick of the Day, footer links, ad slots, meta tags, etc.
--
-- WHERE IT LIVES
--   - blog_customizations: already a reserved jsonb column on wordpress_sites
--     (migration 085 anticipated this). We just start writing/reading it here.
--   - logo_url / header_banner_url: NEW per-site columns added below. NULL means
--     "inherit the account default from brand_profiles". They stay NULL here so
--     every blog keeps inheriting the account logo/banner until the user sets a
--     per-blog one on the Customize page.
--
-- INDEPENDENCE (no data loss)
--   - We seed EVERY existing site's blog_customizations with the current
--     account-level value (integrations.blog_customizations) so each blog starts
--     exactly where it is today, then they diverge independently as the user
--     edits each one. Editing one blog never touches another.
--   - The app also seeds this lazily on read as a safety net, so it works even
--     before this migration runs — but running it does the backfill in bulk and,
--     critically, adds the logo/banner columns the per-blog logo feature needs.
--   - Guarded by "is null", so re-running never clobbers a blog the user has
--     since customized.

-- ── New per-site branding columns ───────────────────────────────────────────
alter table public.wordpress_sites
  add column if not exists logo_url text,
  add column if not exists header_banner_url text;

comment on column public.wordpress_sites.logo_url is
  'Per-site logo override. NULL = inherit brand_profiles.logo_url (account default).';
comment on column public.wordpress_sites.header_banner_url is
  'Per-site wide header banner override. NULL = inherit brand_profiles.header_banner_url.';
comment on column public.wordpress_sites.blog_customizations is
  'Per-site Customize Blog set (Pick of the Day, footer links, ad slots, layout '
  'toggles, meta tags, analytics, newsletter inline, etc.). Independent per blog.';

-- ── Backfill: give EVERY site its own copy of the current settings ──────────
-- Only fills where the site''s value is still NULL, so re-running never
-- clobbers a blog the user has since customized.
update public.wordpress_sites ws
set blog_customizations = i.blog_customizations
from public.integrations i
where i.user_id = ws.user_id
  and ws.blog_customizations is null
  and i.blog_customizations is not null;
