-- 393: plan and billing fields can only be written by the server.
--
-- The integrations row's policy lets a signed-in user write their own row, so
-- through the public API a user could set their own tier (admin included),
-- move their quota window, or point stripe_customer_id at someone else's
-- Stripe customer. Every legitimate write of these fields uses the server key
-- (Stripe webhook, checkout, admin set-tier), so for a signed-in session this
-- trigger keeps them as they were; on a new row it starts them as a trial.
-- Other columns are unaffected. Agency seats get the same treatment: an owner
-- may only change a seat's permissions and revoke it, never who it is.
--
-- Safe to run more than once.
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
  else
    new.tier := old.tier;
    new.stripe_customer_id := old.stripe_customer_id;
    new.stripe_subscription_id := old.stripe_subscription_id;
    new.subscription_status := old.subscription_status;
    new.subscription_period_start := old.subscription_period_start;
    new.subscription_period_end := old.subscription_period_end;
  end if;
  return new;
end $$;

drop trigger if exists integrations_guard_billing on public.integrations;
create trigger integrations_guard_billing before insert or update on public.integrations
  for each row execute function public.integrations_guard_billing();

revoke update on public.agency_members from authenticated;
grant update (revoked_at, permissions) on public.agency_members to authenticated;

notify pgrst, 'reload schema';
