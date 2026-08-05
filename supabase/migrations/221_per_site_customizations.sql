-- 221 — per-site Customize Blog (Phase 3 of the multi-site rollout)
--
-- Each connected blog gets its OWN identity + Customize Blog set, instead of one
-- account-wide value shared by every site. This is what lets a user run a
-- remote-control-car blog and a vacuum blog off the same account with different
-- banners, logos, Pick of the Day, footer links, ad slots, layout toggles, etc.
--
-- WHERE IT LIVES
--   - blog_customizations: already a reserved jsonb column on wordpress_sites
--     (migration 085 anticipated this). We just start writing/reading it here.
--   - logo_url / header_banner_url: NEW per-site columns added below. The
--     account-level defaults stay in brand_profiles and act as the fallback when
--     a site hasn't set its own.
--
-- FALLBACK MODEL (no data loss)
--   - A site row whose blog_customizations is NULL inherits the account-level
--     integrations.blog_customizations (the old single value). A site whose
--     logo_url/header_banner_url is NULL inherits brand_profiles.
--   - So existing users see ZERO change until they customize a specific blog.
--   - The backfill below seeds each user's DEFAULT site with their current
--     account-level values, so "what they have today" becomes that blog's own
--     settings explicitly (and any second blog they add inherits the account
--     default until they change it).

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
  'toggles, newsletter inline, etc.). NULL = inherit integrations.blog_customizations.';

-- ── Backfill: seed each user''s DEFAULT site with their current values ───────
-- Only fills where the per-site value is still NULL, so re-running never
-- clobbers a blog the user has since customized.
update public.wordpress_sites ws
set blog_customizations = i.blog_customizations
from public.integrations i
where i.user_id = ws.user_id
  and ws.is_default = true
  and ws.blog_customizations is null
  and i.blog_customizations is not null;

update public.wordpress_sites ws
set logo_url = nullif(btrim(bp.logo_url), '')
from public.brand_profiles bp
where bp.user_id = ws.user_id
  and ws.is_default = true
  and ws.logo_url is null
  and nullif(btrim(bp.logo_url), '') is not null;

update public.wordpress_sites ws
set header_banner_url = nullif(btrim(bp.header_banner_url), '')
from public.brand_profiles bp
where bp.user_id = ws.user_id
  and ws.is_default = true
  and ws.header_banner_url is null
  and nullif(btrim(bp.header_banner_url), '') is not null;
