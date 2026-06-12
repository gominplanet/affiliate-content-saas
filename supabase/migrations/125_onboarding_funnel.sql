-- © 2026 Gominplanet / MVP Affiliate
--
-- Migration 125 — onboarding funnel state (onboarding-epic Phase 2).
--
-- New users are walked through a guided 7-step funnel (WordPress → YouTube →
-- Affiliate Links → Brand Profile → Voice Training → Customize Blog → Face
-- Models) before they land on the full dashboard. We track two things on the
-- existing `integrations` row:
--   - onboarding_completed: the user finished (or explicitly exited) the funnel.
--     Once true, the dashboard stops force-routing them to /onboarding.
--   - onboarding_step: which card (1..7) to resume on. Lets a user leave and
--     come back to exactly where they were.
--
-- The hard gate (WordPress connected) is still derived from
-- integrations.wordpress_url — these columns are the SOFT funnel progress on
-- top of that. Existing users default to step 1 / not-completed; a one-time
-- backfill below marks anyone who already has a connected WordPress site as
-- onboarding_completed so we don't re-funnel the existing base.

alter table public.integrations
  add column if not exists onboarding_completed boolean not null default false,
  add column if not exists onboarding_step smallint not null default 1;

-- Backfill: don't drag existing, already-set-up users back into the funnel.
-- Anyone with a connected WordPress site has clearly onboarded already.
update public.integrations
  set onboarding_completed = true
  where wordpress_url is not null
    and wordpress_url <> ''
    and onboarding_completed = false;

comment on column public.integrations.onboarding_completed is
  'True once the user finished or exited the 7-step onboarding funnel. Gates the /onboarding force-redirect in the dashboard layout.';
comment on column public.integrations.onboarding_step is
  'Resume point (1..7) in the onboarding funnel. 1=WordPress, 2=YouTube, 3=Affiliate Links, 4=Brand Profile, 5=Voice, 6=Customize Blog, 7=Face Models.';
