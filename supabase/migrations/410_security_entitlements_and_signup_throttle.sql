-- 410: two security fixes from the 2026-10-06 audit.
--
-- 1. Entitlement columns are server-only, like tier.
--
--    Migration 393 stopped a signed-in user from writing their own tier and
--    Stripe fields through the public API, but two later entitlement columns
--    on the same row were still writable by the member themselves:
--
--      limits_cohort              (405) 'pro-before-2026-10-06' keeps the
--                                 older, higher Pro caps for good. Any Pro
--                                 member could set it on their own row.
--      legacy_creator_newsletter  (100) raises the newsletter caps.
--
--    No code path writes either one through a member's session (405 and 100
--    set them from the SQL editor), so for a signed-in session the guard now
--    keeps them as they were, and a new row starts without them.
--
--    The columns are added here if missing so the guard can never fail on a
--    database where 405 has not run. Running 405 afterwards still marks the
--    current Pro members: the SQL editor is not a signed-in session.
--
-- 2. signup_attempts: the per-network ceiling on /api/auth/signup-paid, which
--    creates confirmed accounts with the service key and so skipped Supabase's
--    captcha and signup limits (lib/signup-guard.ts). Only the service role
--    reads or writes it: RLS on, no policies.
--
-- Safe to run more than once.

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
  else
    new.tier := old.tier;
    new.stripe_customer_id := old.stripe_customer_id;
    new.stripe_subscription_id := old.stripe_subscription_id;
    new.subscription_status := old.subscription_status;
    new.subscription_period_start := old.subscription_period_start;
    new.subscription_period_end := old.subscription_period_end;
    new.limits_cohort := old.limits_cohort;
    new.legacy_creator_newsletter := old.legacy_creator_newsletter;
  end if;
  return new;
end $$;

drop trigger if exists integrations_guard_billing on public.integrations;
create trigger integrations_guard_billing before insert or update on public.integrations
  for each row execute function public.integrations_guard_billing();

create table if not exists public.signup_attempts (
  id bigserial primary key,
  ip_hash text not null,
  kind text not null default 'paid',
  created_at timestamptz not null default now()
);
create index if not exists signup_attempts_ip_recent_idx
  on public.signup_attempts (ip_hash, created_at desc);
alter table public.signup_attempts enable row level security;
revoke all on public.signup_attempts from anon, authenticated;

notify pgrst, 'reload schema';
