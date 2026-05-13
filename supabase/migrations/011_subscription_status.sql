-- Migration 011: Track subscription status + renewal date in integrations
--
-- The Stripe webhook now writes `subscription_status` and
-- `subscription_period_end` so the billing UI can show renewal dates,
-- past-due warnings, and cancel-at-period-end state.
--
-- Status values used by our webhook:
--   active     — subscription is current and paid
--   canceling  — user cancelled, but still has access until period_end
--   past_due   — most recent invoice payment failed; Stripe is retrying
--   canceled   — subscription terminated; user is on free tier
--   incomplete / trialing / etc. — passed through from Stripe verbatim
--
-- All idempotent so safe to re-run.

alter table public.integrations
  add column if not exists subscription_status     text,
  add column if not exists subscription_period_end timestamptz;

-- Useful for billing dashboards.
create index if not exists integrations_subscription_status_idx
  on public.integrations (subscription_status);
