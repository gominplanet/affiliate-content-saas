-- 362 — two screens stop reporting the plan and start reporting the result.
--
-- BOTH OF THESE WERE THE SAME BUG IN TWO PLACES. A row was written once, at the
-- moment something was ASKED FOR, and nothing ever went back to see whether it
-- happened. The state after that point was a promise wearing the clothes of a
-- record, and on a green screen the two look identical.
--
-- ── 1. A SCHEDULED VIDEO NEVER BECAME PUBLISHED ────────────────────────────
--
-- launch-drain writes `state: goNow ? 'published' : 'scheduled'` once, when the
-- upload returns. Nothing revisits it. So a video scheduled for Tuesday reads
-- "Scheduled on YouTube, goes live 23 Sept 11:30" on Tuesday, on Wednesday, and
-- next month, whether or not YouTube ever made it public. And YouTube does fail
-- to: a video can be stuck processing, age-restricted, or hit a copyright
-- claim, and the publishAt simply does not fire.
--
-- 'published' was only ever reachable by the publish-now path, so a scheduled
-- video could not display it however well it went.
--
-- ── 2. THE COVERAGE GRID COULD NEVER SAY LIVE ──────────────────────────────
--
-- storefront_coverage declares a `live` state, and the file that declares it
-- says why it must exist:
--
--    UPLOADED IS NOT LIVE, and they are deliberately separate. Collapsing them
--    turned the whole map into a claim about what was attempted rather than a
--    record of what is earning.
--
-- Nothing in the codebase ever wrote it. So the thing that comment warns
-- against was the actual behaviour: a map of attempts, read as a map of
-- earnings.
--
-- WHAT MAKES CONFIRMING POSSIBLE. SCOUT already gets back Amazon's own id for
-- the published listing (`mediaAci`) and the server was discarding it, and
-- SCOUT already fetches the creator's list of shoppable media to spot
-- duplicates before uploading. Keeping the id turns that existing call into the
-- confirmation: the listing is live when Amazon still lists it, and the map can
-- finally mean what it says.
--
-- Safe to run more than once.

-- ── the YouTube side ───────────────────────────────────────────────────────
alter table public.launch_items
  add column if not exists confirm_tries integer not null default 0,
  add column if not exists confirmed_at timestamptz;

comment on column public.launch_items.confirm_tries is
  'How many times we have asked YouTube whether this scheduled video actually went public. Bounded, because a video that never publishes must not be polled forever.';

comment on column public.launch_items.confirmed_at is
  'When YouTube confirmed the video is public. Null on a scheduled row means the moment has not arrived or has not been checked; a scheduled row whose publish_at has passed and whose confirmed_at is still null with a reason set is one that did not go out.';

-- ── the Amazon side ────────────────────────────────────────────────────────
alter table public.global_sync_targets
  add column if not exists media_aci text;

comment on column public.global_sync_targets.media_aci is
  'Amazon''s own id for the published shoppable media, as SCOUT reports it. It was being thrown away. Keeping it is what lets a later pass ask Amazon whether the listing is still there, which is the difference between "we uploaded" and "it is live".';

alter table public.storefront_coverage
  add column if not exists media_aci text,
  add column if not exists confirmed_at timestamptz,
  add column if not exists confirm_tries integer not null default 0;

comment on column public.storefront_coverage.media_aci is
  'The listing id this cell is waiting to see on the storefront. Copied from the sync target once SCOUT reports a successful publish.';

comment on column public.storefront_coverage.confirmed_at is
  'When the listing was actually found on the storefront. This is what makes state = live honest; without it, uploaded and live were the same fact told twice.';

comment on column public.storefront_coverage.confirm_tries is
  'How many times we have looked for this listing and not found it. Bounded, and the reason on the row says so once it gives up, because a listing Amazon silently dropped looks exactly like one nobody checked.';

-- Finding the cells that are waiting to be confirmed, per marketplace.
create index if not exists storefront_coverage_confirm_idx
  on public.storefront_coverage (user_id, domain)
  where state = 'uploaded';
