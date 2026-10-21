-- Migration 453: whether a brand's Meta ad count is its own (lib/trybe-pick
-- metaOwnOf, metaTrustOf).
--
-- Seb's Star brands test, 2026-10-21: Loaded, Dose and Rest each read 50,000
-- Meta ads, Meta's most, because the Ad Library is searched by the brand's
-- name as words and those are common words. Each count now keeps how many of
-- the ads SCOUT saw on the page (meta_ads_sample) were run by the brand's own
-- page (meta_ads_own). Not checked yet is null.
--
-- Safe to run twice.
alter table public.trybe_directory add column if not exists meta_ads_own integer;
alter table public.trybe_directory add column if not exists meta_ads_sample integer;
notify pgrst, 'reload schema';
