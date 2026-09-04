-- 311 — Amazon earnings, every stream, in one place.
--
-- Nowhere in Amazon shows a creator what they actually earned. Creator
-- Connections reporting shows CC and EPC but scoped to whichever store is
-- selected, the Associates page shows commissions and bounties but only for the
-- offsite tracking id, and the same CC figure appears in both at wildly
-- different values depending on scope. Every CSV export we tested came back
-- short, and Amazon's own footnote says the detail is not meant to reconcile to
-- the totals.
--
-- So SCOUT replays the endpoints the pages themselves call, in the creator's own
-- session, and the results land here. Two tables: period totals (what the tiles
-- say) and the per-product breakdown behind them.
--
-- Both are keyed so a re-sync of the same window OVERWRITES rather than
-- duplicating. That matters more than it sounds: Amazon's exports are chunked and
-- overlapping, and an accumulate-on-import design silently double counts.
--
-- Money is stored in CENTS. Amazon returns float artifacts like
-- 60.639999866485596, so everything rounds on the way in and no float ever
-- reaches a total.

-- ── Period totals ───────────────────────────────────────────────────────────
create table if not exists public.amazon_earnings_periods (
  user_id        uuid not null references auth.users(id) on delete cascade,
  -- First day of the window. Monthly today; period_type leaves room for daily
  -- without a second table.
  period_start   date not null,
  period_type    text not null default 'month',
  -- Which income stream this row measures:
  --   cc          — Creator Connections (reportType DATEWISE_ASIN)
  --   epc         — Sponsored Products for Creators (reportType SPONSORED_PRODUCTS)
  --   commissions — ordinary Associates commissions
  --   bounties    — Associates bounties
  stream         text not null,
  -- The Amazon store / tracking id these figures are scoped to, kept verbatim so
  -- a row can always be traced back to the exact request that produced it.
  store_id       text not null,
  -- onsite = the storefront and shoppable videos (onamz… ids)
  -- offsite = traffic sent in from YouTube, a blog, socials
  store_scope    text,
  clicks         integer,
  orders         integer,
  quantity       integer,
  earnings_cents bigint,
  revenue_cents  bigint,
  synced_at      timestamptz not null default now(),
  primary key (user_id, period_start, period_type, stream, store_id)
);

create index if not exists amazon_earnings_periods_user_idx
  on public.amazon_earnings_periods (user_id, period_start desc);

-- ── Per-product breakdown ───────────────────────────────────────────────────
create table if not exists public.amazon_earnings_products (
  user_id        uuid not null references auth.users(id) on delete cascade,
  period_start   date not null,
  period_type    text not null default 'month',
  stream         text not null,
  store_id       text not null,
  asin           text not null,
  product_title  text,
  clicks         integer,
  orders         integer,
  earnings_cents bigint,
  revenue_cents  bigint,
  synced_at      timestamptz not null default now(),
  primary key (user_id, period_start, period_type, stream, store_id, asin)
);

create index if not exists amazon_earnings_products_user_idx
  on public.amazon_earnings_products (user_id, period_start desc);
-- Ranking products by what they earned is the whole point of the table.
create index if not exists amazon_earnings_products_earnings_idx
  on public.amazon_earnings_products (user_id, earnings_cents desc);
-- Joining a product back to the videos and posts made about it.
create index if not exists amazon_earnings_products_asin_idx
  on public.amazon_earnings_products (user_id, asin);

alter table public.amazon_earnings_periods  enable row level security;
alter table public.amazon_earnings_products enable row level security;

-- Read-only to the owner. Writes go through the ingest route on the service
-- role, so a compromised browser session can't invent earnings.
drop policy if exists "own earnings periods" on public.amazon_earnings_periods;
create policy "own earnings periods" on public.amazon_earnings_periods
  for select using (auth.uid() = user_id);

drop policy if exists "own earnings products" on public.amazon_earnings_products;
create policy "own earnings products" on public.amazon_earnings_products
  for select using (auth.uid() = user_id);

notify pgrst, 'reload schema';
