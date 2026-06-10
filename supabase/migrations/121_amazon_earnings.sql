-- © 2026 Gominplanet / MVP Affiliate
--
-- Migration 121 — amazon_earnings (revenue loop, epic #249, aggregate-first).
--
-- Stores the per-ASIN commission totals parsed from a creator's uploaded Amazon
-- Associates "Earnings" report (Amazon has no clean realtime API, so it's a
-- manual CSV upload). /api/analytics/amazon-earnings replaces the user's rows on
-- each upload (latest export = current truth) and /analytics shows the total +
-- per-product breakdown. Per-POST attribution (matching ASIN → the post that
-- links it) is a follow-up; this table is the foundation for it.
--
-- Owner-scoped: a VA reads the owner's earnings (is_accepted_member_of). Writes
-- happen only via the service-role upload route — no client INSERT/UPDATE/DELETE
-- policy, same guardrail as migrations 116 + 119.

create table if not exists public.amazon_earnings (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null,          -- the OWNER account the earnings belong to
  asin          text not null,
  product_title text,
  earnings_usd  numeric not null default 0,   -- commission earned
  items_shipped integer not null default 0,
  revenue_usd   numeric not null default 0,   -- gross sales (display only)
  imported_at   timestamptz not null default now()
);

create index if not exists amazon_earnings_user_idx
  on public.amazon_earnings (user_id, earnings_usd desc);

alter table public.amazon_earnings enable row level security;
drop policy if exists amazon_earnings_select on public.amazon_earnings;
create policy amazon_earnings_select on public.amazon_earnings
  for select using (
    user_id = auth.uid() or public.is_accepted_member_of(user_id)
  );

comment on table public.amazon_earnings is
  'Per-ASIN commission totals from a creator''s uploaded Amazon Associates earnings CSV (epic #249). Replaced on each upload; powers the /analytics revenue view. Reads owner+VA scoped; writes via service role only.';
