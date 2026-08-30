-- 305_dub_credits.sql
-- Cloned-voice ("sounds like you") dub credits.
--
-- Standard dubs run on OpenAI TTS and are free + unlimited. The premium lane —
-- the creator's OWN cloned voice, on ElevenLabs — costs a credit. Each plan
-- grants a monthly allowance that ACCUMULATES (unused credits roll over), and
-- creators can buy more (the purchase flow lands later; this is the ledger).
--   1 credit = 1 cloned-voice geo dub.

create table if not exists public.dub_credits (
  user_id        uuid primary key references auth.users(id) on delete cascade,
  balance        integer not null default 0,
  granted_period text,                     -- the period key we last granted for
  updated_at     timestamptz not null default now()
);

alter table public.dub_credits enable row level security;
do $$
begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='dub_credits' and policyname='own dub credits') then
    create policy "own dub credits" on public.dub_credits for select using (auth.uid() = user_id);
  end if;
end $$;

-- Apply the current period's grant if it hasn't been applied yet (ADDS to the
-- balance, so unused credits accumulate), then return the balance.
create or replace function public.dub_credits_balance(p_user uuid, p_period text, p_grant int)
returns integer language plpgsql security definer as $$
declare bal integer; gp text;
begin
  insert into public.dub_credits (user_id, balance, granted_period)
    values (p_user, 0, null)
    on conflict (user_id) do nothing;
  select balance, granted_period into bal, gp from public.dub_credits where user_id = p_user for update;
  if gp is distinct from p_period then
    update public.dub_credits
      set balance = balance + greatest(0, p_grant), granted_period = p_period, updated_at = now()
      where user_id = p_user
      returning balance into bal;
  end if;
  return bal;
end $$;

-- Grant (if due), then spend one credit if available. Returns the new balance,
-- or -1 when there were none to spend.
create or replace function public.dub_credits_spend(p_user uuid, p_period text, p_grant int)
returns integer language plpgsql security definer as $$
declare bal integer;
begin
  perform public.dub_credits_balance(p_user, p_period, p_grant);
  select balance into bal from public.dub_credits where user_id = p_user for update;
  if bal >= 1 then
    update public.dub_credits set balance = balance - 1, updated_at = now() where user_id = p_user
      returning balance into bal;
    return bal;
  end if;
  return -1;
end $$;

-- Add purchased/bonus credits (used by the future buy-a-block flow + admin).
create or replace function public.dub_credits_add(p_user uuid, p_add int)
returns integer language plpgsql security definer as $$
declare bal integer;
begin
  insert into public.dub_credits (user_id, balance, granted_period)
    values (p_user, greatest(0, p_add), null)
    on conflict (user_id) do update set balance = public.dub_credits.balance + greatest(0, p_add), updated_at = now()
    returning balance into bal;
  return bal;
end $$;

grant execute on function public.dub_credits_balance(uuid, text, int) to authenticated, service_role;
grant execute on function public.dub_credits_spend(uuid, text, int)   to authenticated, service_role;
grant execute on function public.dub_credits_add(uuid, int)           to service_role;

notify pgrst, 'reload schema';
