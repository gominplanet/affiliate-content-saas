-- 353 — check the product exists in that country BEFORE anything is dubbed.
--
-- THE ORDER IS THE POINT. The drain went straight from "this video has an ASIN"
-- to "does YouTube already carry French", and from there into the pipeline that
-- translates, dubs and renders a thumbnail. For a product Amazon France has
-- never sold, all of that is spent on a listing that cannot exist, and the
-- creator finds out at the upload, which is the most expensive moment there is.
--
-- So an existence pass runs first, and the dub is only started for a cell that
-- passed it.
--
-- FOUR ANSWERS, NOT A BOOLEAN. `not_listed` and "nobody could look" are
-- opposite facts, and a boolean forces them into the same value. Australia has
-- no Keepa domain at all, so it can never be answered from a server, and a
-- column that could only say true or false would have recorded every Australian
-- cell as not sold there. NULL is a fifth thing again: not checked yet.
--
--   in_stock      listed there and something is buyable right now
--   out_of_stock  listed there, nothing buyable today. Does NOT block: stock
--                 comes back, and a video prepared now is ready when it does.
--   not_listed    Keepa answered and the ASIN is not sold in that country.
--                 This is the one that blocks, and it is the whole saving.
--   no_answer     nobody could look. The cell goes on regardless, because
--                 refusing to ever process Australia is a worse lie than
--                 proceeding without the answer.
--   null          not checked yet. The drain claims on exactly this.
--
-- The same answer is cached across creators in passport_asin_market, which has
-- been holding "is this ASIN a real product on that host" since migration 294.
-- Two creators promoting the same product pay for one lookup between them.
--
-- Safe to run more than once.

-- ── say what is missing, rather than failing on line 65 ─────────────────────
-- `alter table` on a table that does not exist takes the whole file down with a
-- message naming only the table. This one names the migration to run, because
-- the first version of this file died on keepa_product_cache and "relation does
-- not exist" is not an instruction.
do $$
begin
  if to_regclass('public.storefront_coverage') is null then
    raise exception 'storefront_coverage is missing. Run migration 351 first, then this one.';
  end if;
  if to_regclass('public.passport_asin_market') is null then
    raise exception 'passport_asin_market is missing. Run migration 294 first, then this one.';
  end if;
end $$;

-- ── the per-cell answer ─────────────────────────────────────────────────────
alter table public.storefront_coverage
  add column if not exists stock    text,
  add column if not exists stock_at timestamptz;

comment on column public.storefront_coverage.stock is
  'in_stock | out_of_stock | not_listed | no_answer, or NULL for not checked yet. The first pass, before anything is translated or dubbed: dubbing a video for a product that country has never sold spends minutes of render on a listing that cannot exist. Four values rather than a boolean because "not sold there" and "nobody could look" are opposite facts, and Australia has no Keepa domain so it can never be answered from a server.';

-- The claim query for the existence pass: cells that have an ASIN and no answer
-- yet. Partial, because once the grid is drained this is almost always empty and
-- it should cost nothing to find that out.
create index if not exists storefront_coverage_stock_idx
  on public.storefront_coverage (user_id, priority desc)
  where state = 'unknown' and stock is null;

-- ── the shared cache gets the stock half ────────────────────────────────────
-- 294 answered existence only. The price is what says whether anything is
-- actually buyable, and it arrives in the same Keepa response, so storing it
-- costs one column and no extra lookup.
alter table public.passport_asin_market
  add column if not exists in_stock    boolean,
  add column if not exists price_cents integer;

comment on column public.passport_asin_market.in_stock is
  'Whether anything was buyable in that marketplace at checked_at. NULL where the writer did not know: SCOUT''s /dp probe answers existence but not the buy box, so it leaves this alone rather than guessing false.';

-- ── the title, so the general Keepa cache can tell the two failures apart ───
-- keepa_product_cache (288) stored price and rank but not the title, and the
-- title is the existence answer. Without it a cached row cannot say whether
-- Keepa found no listing or whether the fetch simply returned nothing.
--
-- SKIPPED rather than fatal if that table is absent: it belongs to the EPC
-- enrichment, not to coverage, and nothing in this feature reads it. Blocking
-- the geo work over another feature's cache column would be the wrong trade.
do $$
begin
  if to_regclass('public.keepa_product_cache') is null then
    raise notice 'keepa_product_cache is absent (migration 288 not applied). Skipping its title column; coverage does not read it.';
  else
    alter table public.keepa_product_cache add column if not exists title text;
  end if;
end $$;

-- ── the summary, so a stalled existence check is visible ────────────────────
--
-- THIS SUPERSEDES THE COPY IN 352. That version is left alone as history; this
-- is the live definition, and it lives here rather than in 352 because 352 runs
-- before the `stock` column exists and could not reference it.
--
-- WHAT THIS ADDS. Before it, a cell waiting on the existence check and a cell
-- genuinely being translated were both counted as "being prepared". So a Keepa
-- key that expired, or a token pool the rest of the product keeps empty, would
-- read on screen as steady progress forever. That is the exact failure this
-- codebase keeps producing: silence that looks identical to success.
--
-- `checking` is the count still waiting on the first pass, per market, and the
-- board says so in those words.
--
-- SECURITY INVOKER, so the caller's RLS policy still decides whose rows they
-- can count. A definer function here would hand any signed-in user the map for
-- anybody else's account.

create or replace function public.storefront_coverage_summary(p_user uuid)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  select jsonb_build_object(
    'videos', (
      select count(*) from public.youtube_videos where user_id = p_user
    ),
    -- THE HEADLINE: distinct videos earning in at least one ENABLED market.
    -- Distinct, because counting rows would report a video live in five
    -- countries as five videos and flatter the number fivefold.
    'videosAbroad', (
      select count(distinct c.video_id)
        from public.storefront_coverage c
        join public.storefront_markets m
          on m.user_id = c.user_id and m.domain = c.domain and m.enabled
       where c.user_id = p_user
         and c.state in ('uploaded', 'live')
    ),
    -- One row per (market, state, reason). The reason travels with the count so
    -- the screen can say what is in the way rather than only how much.
    'buckets', coalesce((
      select jsonb_agg(jsonb_build_object('domain', d, 'state', s, 'reason', r, 'n', n))
        from (
          select domain as d, state as s, reason as r, count(*) as n
            from public.storefront_coverage
           where user_id = p_user
           group by domain, state, reason
        ) t
    ), '[]'::jsonb),
    -- Still waiting on the product check, which is the step before any dub.
    -- Counted apart from 'preparing' so a check that has stopped running does
    -- not read as work in progress.
    'checking', coalesce((
      select jsonb_agg(jsonb_build_object('domain', d, 'n', n))
        from (
          select domain as d, count(*) as n
            from public.storefront_coverage
           where user_id = p_user and state = 'unknown' and stock is null
           group by domain
        ) t
    ), '[]'::jsonb)
  )
$$;

comment on function public.storefront_coverage_summary(uuid) is
  'Coverage counts for one creator, computed in Postgres. No screen may count a fetched array: PostgREST caps a response at 1000 rows and a multi-market catalogue is far more than that, which turned a page length into a total on screen three times in this feature''s history. `checking` is the cells still waiting on the product existence check, kept apart from `preparing` so a check that has stopped running cannot read as progress.';

notify pgrst, 'reload schema';
