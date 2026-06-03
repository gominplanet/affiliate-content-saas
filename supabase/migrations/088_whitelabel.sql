-- Migration 088 — White-label branding columns on integrations.
--
-- Pro users can override the dashboard branding with their own logo + accent
-- colour + brand name. Reads happen on every dashboard page render, so this
-- HAS to be a column on `integrations` (which is already loaded on every
-- authenticated page) rather than a separate table — keeps the read path
-- to zero extra queries.
--
-- Columns are nullable. NULL on any of them means "use the default MVP
-- Affiliate branding for that piece". A user can set just a colour, just
-- a logo, or all three.

ALTER TABLE integrations
  ADD COLUMN IF NOT EXISTS whitelabel_logo_url text,
  ADD COLUMN IF NOT EXISTS whitelabel_brand_name text,
  ADD COLUMN IF NOT EXISTS whitelabel_accent_color text;

-- Soft constraints — checked at the DB so a future direct INSERT (e.g. via
-- a migration helper or admin update) can't ship malformed data either.
-- Accent must be a 7-char #hex (no shorthand like #abc — Satori / Tailwind
-- both want 6-char forms). Brand name is short and bounded.
ALTER TABLE integrations
  ADD CONSTRAINT whitelabel_accent_format
    CHECK (whitelabel_accent_color IS NULL OR whitelabel_accent_color ~* '^#[0-9a-f]{6}$');

ALTER TABLE integrations
  ADD CONSTRAINT whitelabel_brand_name_len
    CHECK (whitelabel_brand_name IS NULL OR (length(whitelabel_brand_name) >= 1 AND length(whitelabel_brand_name) <= 40));

COMMENT ON COLUMN integrations.whitelabel_logo_url IS
  'Pro-only. Logo URL shown in the sidebar + dashboard header in place of the MVP Affiliate logo. NULL = use the default.';
COMMENT ON COLUMN integrations.whitelabel_brand_name IS
  'Pro-only. Brand name shown in the sidebar + browser tab title. NULL = "MVP Affiliate".';
COMMENT ON COLUMN integrations.whitelabel_accent_color IS
  'Pro-only. Accent hex colour applied to primary buttons + links. NULL = #7C3AED (default purple). Must be 7-char hex.';
