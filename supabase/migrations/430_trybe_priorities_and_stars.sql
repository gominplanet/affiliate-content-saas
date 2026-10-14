-- 430: what matters to a creator when MVP ranks TRYBE brands, and the brands
-- they starred (Seb, 2026-10-14, after Rob's Oink Blue video: "build all 4").
--
-- priorities: { factor: 0 | 1 | 2 } (does not matter, normal, matters a lot),
--   read by lib/trybe-pick readPriorities; anything missing reads as normal.
-- starred: TRYBE brand ids.
--
-- Safe to run twice.

alter table public.trybe_outreach_settings add column if not exists priorities jsonb;
alter table public.trybe_outreach_settings add column if not exists starred text[] not null default '{}';

notify pgrst, 'reload schema';
