-- 285 — Passport Links: bake the attribution source into the short code.
--
-- Before this, a per-surface link looked like  mvpl.ink/gjzfswr?s=blog  — the
-- ?s= tail carried the source (logged + passed to Amazon as ascsubtag) but made
-- the URL long and ugly. Now each (product, source) gets its own clean short
-- code, so the link is just  mvpl.ink/gjzfswr  with the source stored on the row
-- and read back at redirect time. Same attribution, cleaner link.

alter table public.passport_links
  add column if not exists source text;

-- The old uniqueness was one link per (user, site, asin). We now allow one per
-- (user, site, asin, source) so each surface gets its own clean code. Drop the
-- old constraint and replace it with a null-safe unique index (site_id and
-- source can both be null; coalesce keeps those rows unique instead of infinitely
-- duplicable, which a plain unique index over nullable columns would allow).
alter table public.passport_links
  drop constraint if exists passport_links_user_id_site_id_asin_key;

create unique index if not exists passport_links_user_site_asin_source_uidx
  on public.passport_links (
    user_id,
    coalesce(site_id, '00000000-0000-0000-0000-000000000000'::uuid),
    asin,
    coalesce(source, '')
  );

notify pgrst, 'reload schema';
