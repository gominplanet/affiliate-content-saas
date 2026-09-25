-- Migration 373: "On sale now" checks, and saved Amazon Live plans.
--
-- ON SALE NOW. A daily job looks at the products a creator has already made
-- content about and raises an alert when one goes on sale. This table only
-- remembers when each creator was last checked, so the job can go round
-- everyone fairly within its budget. The alerts themselves go into the
-- existing price_alerts table (kind 'covered_sale'), so they appear in the
-- dashboard's Price Alerts box with no new screen needed.
--
-- AMAZON LIVE PREP. A plan for one live stream: the products in order, the
-- run of show, talking points and the on-screen deal list, saved so it can be
-- opened again on the day, in the teleprompter view.
--
-- Safe to run twice.

create table if not exists public.covered_sale_checks (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  checked_at timestamptz not null default now(),
  asins      integer not null default 0,
  on_sale    integer not null default 0
);
alter table public.covered_sale_checks enable row level security;
drop policy if exists "covered_sale_checks_own_read" on public.covered_sale_checks;
create policy "covered_sale_checks_own_read" on public.covered_sale_checks
  for select to authenticated using (user_id = auth.uid());

create table if not exists public.live_plans (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  title      text not null default 'Amazon Live',
  minutes    integer not null default 45,
  products   jsonb not null default '[]'::jsonb,
  plan       jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists live_plans_user_idx on public.live_plans (user_id, updated_at desc);
alter table public.live_plans enable row level security;
drop policy if exists "live_plans_own" on public.live_plans;
create policy "live_plans_own" on public.live_plans
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
