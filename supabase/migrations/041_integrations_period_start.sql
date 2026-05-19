-- Migration 041: integrations.subscription_period_start
--
-- We already store subscription_period_end (the renewal date) from the
-- Stripe webhook. To meter usage per BILLING CYCLE (not calendar month)
-- we also need the period start — the quota window is
-- [period_start, period_end). Falls back to calendar month when null
-- (free tier, no subscription, or legacy rows before this column).
--
-- Idempotent.

alter table public.integrations
  add column if not exists subscription_period_start timestamptz;
