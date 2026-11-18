-- 470: remember which TRYBE samples are sold on Amazon (Seb, 2026-11-18:
-- "let's prepare an Amazon Live with Tribe products that exist on Amazon").
-- Amazon Live Prep looks each received sample up once a month, not on every
-- press (lib/live-trybe, app/api/live/trybe). Safe to run twice.

alter table public.trybe_samples add column if not exists amazon_asin text;
alter table public.trybe_samples add column if not exists amazon_title text;
alter table public.trybe_samples add column if not exists amazon_by text;
alter table public.trybe_samples add column if not exists amazon_checked_at timestamptz;

notify pgrst, 'reload schema';
