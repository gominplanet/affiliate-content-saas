-- ── 444: one free week per creator ─────────────────────────────────────────
-- Seb, 2026-10-19: the monthly plan starts with 7 days free, card at signup,
-- charged on day 8 unless cancelled. One free week per creator: every free
-- week started is written here with the card and email it started on, and a
-- signup matching an earlier one (or an earlier refund in creator_refunds) is
-- charged on the day it joins. Server only. Safe to run twice.

create table if not exists public.creator_trials (
  user_id uuid primary key,
  email_norm text,
  card_fingerprint text,
  stripe_customer_id text,
  stripe_subscription_id text,
  -- false when the free week was refused at signup and the month charged at once
  free_week boolean not null default true,
  reason text,
  started_at timestamptz not null default now()
);
create index if not exists creator_trials_email_idx on public.creator_trials (email_norm);
create index if not exists creator_trials_card_idx on public.creator_trials (card_fingerprint);
alter table public.creator_trials enable row level security;
revoke all on public.creator_trials from anon, authenticated;

notify pgrst, 'reload schema';
