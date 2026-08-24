-- 286 — Passport Links: support ANY link, not just Amazon products.
--
-- Until now a Passport link had to resolve to an Amazon ASIN (for geo-routing to
-- each country's store). Creators also want to shorten + track links that aren't
-- Amazon (a Walmart page, a brand store, a landing page). For those we store the
-- destination URL and the redirect just forwards to it (a branded short link with
-- click analytics). Amazon ASIN links keep full geo-routing.

-- asin is now optional (null for a plain destination link).
alter table public.passport_links
  alter column asin drop not null;

-- Where a non-Amazon link points.
alter table public.passport_links
  add column if not exists destination_url text;

-- A link must be one or the other (an Amazon ASIN, or a destination URL).
alter table public.passport_links
  drop constraint if exists passport_links_target_present;
alter table public.passport_links
  add constraint passport_links_target_present
  check (asin is not null or destination_url is not null);

-- Uniqueness now spans the target (asin OR destination) so both kinds dedupe
-- per (user, site, target, source). Replaces the asin-only index from 285.
drop index if exists passport_links_user_site_asin_source_uidx;
create unique index if not exists passport_links_user_site_target_source_uidx
  on public.passport_links (
    user_id,
    coalesce(site_id, '00000000-0000-0000-0000-000000000000'::uuid),
    coalesce(asin, ''),
    coalesce(destination_url, ''),
    coalesce(source, '')
  );

notify pgrst, 'reload schema';
