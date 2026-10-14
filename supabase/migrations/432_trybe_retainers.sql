-- © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
--
-- 432: RETAINERS YOU TRACK (Seb, 2026-10-14: "build 1, 2, 3, and 4"). The
-- retainers a creator agreed with TRYBE brands (amount, videos, smart or
-- standard, start date), so My brands can show videos due, days left and the
-- top up (lib/trybe-retainer). The creator's own, written by the server only.
--
-- Safe to run twice.

alter table public.trybe_outreach_settings add column if not exists retainers jsonb not null default '[]'::jsonb;

notify pgrst, 'reload schema';
