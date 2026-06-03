-- 090 — Newsletter: A/B subjects, scheduling, segments
--
-- Three additive features on top of the existing newsletter pipeline (074).
-- All changes are additive — no existing column is dropped or renamed; old
-- broadcasts keep working unchanged.
--
-- ──────────────────────────────────────────────────────────────────────────
-- 1. A/B subject lines on broadcasts
-- ──────────────────────────────────────────────────────────────────────────
--
-- Workflow:
--   1. Compose-time the user types Subject A + optional Subject B + a sample
--      pct (default 20%). The remaining 80% gets the winning subject after
--      the test settles.
--   2. /api/newsletter/send detects subject_b + ab_sample_pct, randomly
--      partitions sample_pct of recipients into half-A / half-B, sends them
--      RIGHT NOW with the corresponding subject, tags every email with
--      kind=newsletter_broadcast + broadcast_id + variant=a|b. Status flips
--      to 'ab_testing'. ab_finalize_at is set to now() + ab_test_hours h.
--   3. /api/cron/newsletter-process (Vercel cron, every minute) finds rows
--      where status='ab_testing' AND ab_finalize_at <= now(); reads
--      ab_opens_a vs ab_opens_b; picks the winner; sends the winning
--      subject to the remaining (100 - sample_pct)% of recipients; status
--      flips to 'sent'.
--   4. Resend webhook (resend-webhook/route.ts) reads the variant tag and
--      ticks ab_opens_a OR ab_opens_b per open event.
--
-- We snapshot which recipient IDs got which variant so the webhook can
-- attribute correctly even if subscribers churn between the test send and
-- the open events arriving.
alter table public.newsletter_broadcasts
  add column if not exists subject_b text,
  add column if not exists ab_sample_pct integer,
  add column if not exists ab_test_hours integer,
  add column if not exists ab_finalize_at timestamptz,
  add column if not exists ab_finalized_at timestamptz,
  add column if not exists ab_winner_variant text,             -- 'a' | 'b' | null
  add column if not exists ab_recipients_a uuid[] not null default '{}',
  add column if not exists ab_recipients_b uuid[] not null default '{}',
  add column if not exists ab_opens_a integer not null default 0,
  add column if not exists ab_opens_b integer not null default 0,
  -- Granular compose-time fields. Existing broadcasts only have the rendered
  -- HTML; for A/B winner-send + scheduled-send the cron needs to re-render
  -- from the structured inputs (per-recipient unsub URL must be rebuilt).
  add column if not exists compose_intro text,
  add column if not exists compose_outro text;

-- Status path now also includes 'scheduled' (queued for future send) and
-- 'ab_testing' (sample sent, awaiting winner finalization). Existing values
-- ('draft' | 'sending' | 'sent' | 'failed') are unchanged.

-- ──────────────────────────────────────────────────────────────────────────
-- 2. Scheduling
-- ──────────────────────────────────────────────────────────────────────────
--
-- scheduled_at already exists from migration 074. The send route accepts
-- a scheduled_at param: when present and in the future, the row goes in
-- with status='scheduled' and recipients_total snapshotted but no emails
-- are sent. The cron processor picks it up at the scheduled time.

-- Index for the cron to pick scheduled rows efficiently (small table, but
-- worth doing — the cron runs every minute).
create index if not exists newsletter_broadcasts_scheduled_idx
  on public.newsletter_broadcasts (status, scheduled_at)
  where status in ('scheduled', 'ab_testing');

-- ──────────────────────────────────────────────────────────────────────────
-- 3. Segmented sends
-- ──────────────────────────────────────────────────────────────────────────
--
-- segment_filter JSONB on broadcasts narrows the recipient list at send
-- time. Schema:
--   {
--     source?:        'blog_form' | 'csv_import' | 'manual',
--     signedUpAfter?: ISO timestamp,
--     signedUpBefore?: ISO timestamp,
--     tags?:          string[]      // ANY-of match against subscriber.tags
--   }
-- All filters AND together. A null/empty segment_filter means "send to all
-- active subscribers" (the historical behaviour, preserved).
alter table public.newsletter_broadcasts
  add column if not exists segment_filter jsonb;

-- Per-subscriber tag column for segmentation. Free-text labels the creator
-- applies (e.g. 'paying', 'lead', 'archived'). Default empty array.
alter table public.newsletter_subscribers
  add column if not exists tags text[] not null default '{}';

-- GIN index so segment_filter.tags lookups (subscribers where tags && filter.tags)
-- stay fast even at 50k+ subscribers.
create index if not exists newsletter_subscribers_tags_gin
  on public.newsletter_subscribers using gin (tags);

-- ──────────────────────────────────────────────────────────────────────────
-- 4. Extend the broadcast-counter RPC to allow ab_opens_a + ab_opens_b
-- ──────────────────────────────────────────────────────────────────────────
--
-- The original 080 allowlist only knew the four overall recipient counters.
-- The Resend webhook now also bumps the per-variant open counters when the
-- email it processes was tagged with a variant. Re-creating the function
-- is safe — same signature, broader allowlist.
create or replace function public.increment_broadcast_counter(
  p_broadcast_id uuid,
  p_user uuid,
  p_column text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_column not in (
    'recipients_delivered',
    'recipients_bounced',
    'recipients_opened',
    'recipients_clicked',
    'ab_opens_a',
    'ab_opens_b'
  ) then
    raise exception 'Invalid counter column: %', p_column;
  end if;

  execute format(
    'update public.newsletter_broadcasts set %I = coalesce(%I, 0) + 1 where id = $1 and user_id = $2',
    p_column, p_column
  ) using p_broadcast_id, p_user;
end
$$;
