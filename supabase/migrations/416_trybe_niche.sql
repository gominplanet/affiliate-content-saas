-- 416: TRYBE outreach (Labs) works to a niche, not every brand.
--
-- Seb, 2026-10-06: "we need to be able to select what niche we're interested
-- in or at least a few keywords ... not just blindly message all brands".
--
-- trybe_outreach_settings: the categories and keywords the creator wants,
-- whether MVP finds a day's brands by itself when the page is opened, and when
-- it last did.
--
-- trybe_brands: MVP's judgement of each brand against those, from its TRYBE
-- profile and its website. A brand that does not fit is status 'not_fit' and
-- is never drafted or sent unless the creator picks it. `fit_prefs` is what
-- it was judged against, so changing the niche judges it again.
--
-- Safe to run twice.

alter table public.trybe_outreach_settings add column if not exists categories text[] not null default '{}';
alter table public.trybe_outreach_settings add column if not exists keywords text[] not null default '{}';
alter table public.trybe_outreach_settings add column if not exists daily_find boolean not null default true;
alter table public.trybe_outreach_settings add column if not exists last_find_at timestamptz;

alter table public.trybe_brands add column if not exists fit_score integer;
alter table public.trybe_brands add column if not exists fit_reason text;
alter table public.trybe_brands add column if not exists fit_prefs text;
alter table public.trybe_brands add column if not exists fit_checked_at timestamptz;

notify pgrst, 'reload schema';
