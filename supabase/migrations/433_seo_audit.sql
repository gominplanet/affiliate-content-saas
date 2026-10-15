-- 433: the last "Audit my site" result on the SEO page (lib/seo-audit,
-- app/api/seo/audit). Kept so the page opens on the last audit instead of an
-- empty card, and so a second press within two minutes does not crawl the
-- member's site again. Safe to run twice.
alter table public.integrations
  add column if not exists seo_audit    jsonb,
  add column if not exists seo_audit_at timestamptz;
