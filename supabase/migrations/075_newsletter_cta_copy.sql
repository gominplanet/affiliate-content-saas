-- 075 — Editable CTA copy for the auto-embedded signup form
--
-- Until now the form's title / subtitle / button label were baked into
-- the WP theme via the shared mvp_affiliate_render_newsletter_form()
-- defaults. Creators had no dashboard surface to tweak them — they'd
-- have to edit theme files, which they can't (and shouldn't).
--
-- Three nullable columns: NULL means "use the theme's default", a
-- value overrides per-placement (we push them into
-- affiliateos_customizations.newsletter so the theme picks them up).
-- We deliberately keep ONE shared set rather than separate
-- homepage/sidebar overrides — fewer fields to fill in, and most
-- creators want a single voice on the CTA anyway.

alter table public.newsletter_settings
  add column if not exists cta_title text,
  add column if not exists cta_subtitle text,
  add column if not exists cta_button text;
