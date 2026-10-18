-- 439 Pro only, no trial, a 7-day refund once per creator (Seb, 2026-10-18).
--
-- 1. integrations.subscribed_at: when the member's current subscription
--    started, from Stripe's own start date (the webhook writes it). The first
--    7 days after it run at a quarter of each monthly allowance
--    (lib/intro-allowance), so a refund cannot cost a month of AI. Server-only,
--    like tier: the billing guard below keeps a signed-in member from setting
--    it on their own row.
--
-- 2. creator_refunds: every refund given, with what identifies the creator
--    (email, the card's Stripe fingerprint, YouTube channel, Amazon Associates
--    tag, storefront). The refund is once per creator: a later account that
--    matches any of them can still subscribe, but its first payment is not
--    covered (lib/creator-refund). Only the service role reads or writes it.
--
-- Safe to run more than once.

alter table public.integrations add column if not exists subscribed_at timestamptz;
alter table public.integrations add column if not exists limits_cohort text;
alter table public.integrations add column if not exists legacy_creator_newsletter boolean not null default false;

create or replace function public.integrations_guard_billing()
returns trigger language plpgsql set search_path = public as $$
begin
  if coalesce(auth.role(), '') <> 'authenticated' then return new; end if;
  if tg_op = 'INSERT' then
    new.tier := 'trial';
    new.stripe_customer_id := null;
    new.stripe_subscription_id := null;
    new.subscription_status := null;
    new.subscription_period_start := null;
    new.subscription_period_end := null;
    new.limits_cohort := null;
    new.legacy_creator_newsletter := false;
    new.subscribed_at := null;
  else
    new.tier := old.tier;
    new.stripe_customer_id := old.stripe_customer_id;
    new.stripe_subscription_id := old.stripe_subscription_id;
    new.subscription_status := old.subscription_status;
    new.subscription_period_start := old.subscription_period_start;
    new.subscription_period_end := old.subscription_period_end;
    new.limits_cohort := old.limits_cohort;
    new.legacy_creator_newsletter := old.legacy_creator_newsletter;
    new.subscribed_at := old.subscribed_at;
  end if;
  return new;
end $$;

drop trigger if exists integrations_guard_billing on public.integrations;
create trigger integrations_guard_billing before insert or update on public.integrations
  for each row execute function public.integrations_guard_billing();

create table if not exists public.creator_refunds (
  id bigserial primary key,
  user_id uuid not null,
  email_norm text,
  card_fingerprint text,
  youtube_channel_id text,
  amazon_tag text,
  storefront text,
  stripe_customer_id text,
  stripe_subscription_id text,
  stripe_refund_id text,
  amount_cents integer,
  refunded_by uuid,
  note text,
  refunded_at timestamptz not null default now()
);
create index if not exists creator_refunds_email_idx on public.creator_refunds (email_norm);
create index if not exists creator_refunds_card_idx on public.creator_refunds (card_fingerprint);
create index if not exists creator_refunds_channel_idx on public.creator_refunds (youtube_channel_id);
create index if not exists creator_refunds_tag_idx on public.creator_refunds (amazon_tag);
create index if not exists creator_refunds_storefront_idx on public.creator_refunds (storefront);
alter table public.creator_refunds enable row level security;
revoke all on public.creator_refunds from anon, authenticated;

notify pgrst, 'reload schema';
