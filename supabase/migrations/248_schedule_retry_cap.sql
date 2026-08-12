-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 248 — Attempt cap for scheduled-post reclaim (stop poison-pill loops)
--
-- process-deal-schedules and process-amazon-schedules both run a "stuck-claim
-- recovery": any row left in status='processing' with claimed_at older than
-- 5 min (a tick that died mid-publish) is flipped back to 'pending' so the next
-- tick retries it. Neither table tracked how many times a row had been reclaimed,
-- so a row whose publish reliably outlives the serverless wall-clock (a hung
-- Amazon scrape, a Cloudinary stall) would be re-claimed → re-run the billable
-- work → get killed → flipped back to pending, forever, re-billing every tick.
--
-- This adds an `attempts` counter to both tables and a single reclaim RPC that
-- terminal-fails a row once it has burned through the cap instead of returning
-- it to 'pending'. Ordinary failures already terminal-fail in the route's
-- try/catch; this only closes the "killed before it could write a status" loop.
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.deal_scheduled_posts
  add column if not exists attempts integer not null default 0;

alter table public.amazon_scheduled_posts
  add column if not exists attempts integer not null default 0;

-- Reclaim stuck rows with an attempt cap. Two statements in one call:
--   1. Poison pills (stuck AND already at the cap) → terminal 'failed'.
--   2. Everyone else stuck → bump attempts, back to 'pending' for one more try.
-- Table name is allow-listed (dynamic SQL is security-definer) so a caller can't
-- point it at an arbitrary table. Returns the number of rows terminal-failed.
create or replace function public.reclaim_stuck_scheduled_posts(
  p_table text,
  p_stuck_before timestamptz,
  p_max_attempts integer
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  failed_count int;
begin
  if p_table not in ('deal_scheduled_posts', 'amazon_scheduled_posts') then
    raise exception 'reclaim_stuck_scheduled_posts: invalid table %', p_table;
  end if;

  -- 1. Terminal-fail poison pills: stuck past the deadline AND already retried
  --    up to the cap. Stops the infinite reclaim/re-bill loop.
  execute format(
    'update public.%I
        set status = ''failed'',
            error_message = ''[auto-failed] Publish kept timing out (hit the '' || %L || '' retry cap) — stopped retrying.'',
            updated_at = now()
      where status = ''processing''
        and claimed_at < $1
        and coalesce(attempts, 0) >= $2',
    p_table, p_max_attempts
  ) using p_stuck_before, p_max_attempts;
  get diagnostics failed_count = row_count;

  -- 2. Reclaim the rest: bump the attempt counter and return to pending.
  execute format(
    'update public.%I
        set status = ''pending'',
            attempts = coalesce(attempts, 0) + 1,
            updated_at = now()
      where status = ''processing''
        and claimed_at < $1
        and coalesce(attempts, 0) < $2',
    p_table
  ) using p_stuck_before, p_max_attempts;

  return failed_count;
end
$$;

revoke all on function public.reclaim_stuck_scheduled_posts(text, timestamptz, integer) from public;
grant execute on function public.reclaim_stuck_scheduled_posts(text, timestamptz, integer)
  to authenticated, service_role;

comment on function public.reclaim_stuck_scheduled_posts(text, timestamptz, integer) is
  'Reclaims scheduled-post rows stuck in processing: terminal-fails those past '
  'p_max_attempts, bumps attempts and re-queues the rest. Allow-listed to '
  'deal_scheduled_posts / amazon_scheduled_posts. Returns rows terminal-failed.';
