-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 100 — Grandfather existing Creator subscribers on the OLD
-- newsletter caps after the 2026-06-04 tier restructure dropped them
-- (subscribers 1000→500, broadcasts/month 4→1).
--
-- Adds `integrations.legacy_creator_newsletter boolean default false`.
-- Backfills true for any row currently on tier='creator' with an active
-- Stripe subscription — those users were paying when the cap dropped, so
-- they keep their old numbers until they cancel/downgrade.
--
-- The helpers in lib/tier.ts read this flag via an `opts` arg and return
-- the pre-2026-06-04 values (1000/4) instead of the new defaults (500/1)
-- when it's true. No tier mutation, no Stripe mutation — purely cap math.
--
-- Run order: after 099b. Idempotent (IF NOT EXISTS guards).
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.integrations
  add column if not exists legacy_creator_newsletter boolean not null default false;

comment on column public.integrations.legacy_creator_newsletter is
  'Set true for Creator-tier users paying as of the 2026-06-04 newsletter cap drop. '
  'Read by lib/tier.ts allowedNewsletterSubscribers / allowedNewsletterBroadcasts to '
  'return the OLD caps (1000 subs / 4 sends per month) instead of the new defaults '
  '(500 / 1). Stays true until the user cancels or downgrades — there is no UI to '
  'toggle it back on.';

-- Backfill: anyone who was on Creator with an active Stripe sub at run
-- time keeps the legacy caps. Free-trial Creators and anyone without an
-- active subscription do not — they would not have started paying yet, so
-- the new caps apply naturally.
update public.integrations
  set legacy_creator_newsletter = true
  where tier = 'creator'
    and stripe_subscription_id is not null
    and legacy_creator_newsletter = false;
