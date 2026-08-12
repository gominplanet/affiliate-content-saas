-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 249 — Extend the stuck-claim retry cap to scheduled_posts
--
-- Migration 248 added reclaim_stuck_scheduled_posts for the deal/amazon
-- schedulers. process-scheduled (the main social-post cron) has the SAME
-- uncapped stuck-claim reclaim: it flips rows stuck in 'processing' back to
-- 'pending' with no attempt cap, so a publish that hard-crashes the function
-- before its try/catch runs (a call that hangs to the 60s maxDuration every
-- time) is reclaimed forever. MAX_PUBLISH_RETRIES only governs the caught-error
-- path, not this reclaim.
--
-- This generalizes the reclaim RPC to pick the right counter column per table
-- (scheduled_posts already has retry_count; the deal/amazon tables use attempts
-- from migration 248) and allow-lists scheduled_posts. The 3-arg signature is
-- unchanged, so the existing deal/amazon callers keep working as-is.
--
-- The terminal message is prefixed '[auto-failed]' so channel-health.ts excludes
-- these rows from the dead-channel streak (a job hard-crashing is not evidence
-- the channel connection is broken).
-- ─────────────────────────────────────────────────────────────────────────────

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
  counter_col text;
begin
  -- Per-table attempt counter (allow-listed; dynamic SQL is security-definer).
  if p_table = 'scheduled_posts' then
    counter_col := 'retry_count';
  elsif p_table in ('deal_scheduled_posts', 'amazon_scheduled_posts') then
    counter_col := 'attempts';
  else
    raise exception 'reclaim_stuck_scheduled_posts: invalid table %', p_table;
  end if;

  -- 1. Terminal-fail poison pills: stuck past the deadline AND already at the cap.
  execute format(
    'update public.%I
        set status = ''failed'',
            error_message = ''[auto-failed] Publish kept timing out (hit the '' || %L || '' retry cap) — stopped retrying.'',
            updated_at = now()
      where status = ''processing''
        and claimed_at < $1
        and coalesce(%I, 0) >= $2',
    p_table, p_max_attempts, counter_col
  ) using p_stuck_before, p_max_attempts;
  get diagnostics failed_count = row_count;

  -- 2. Reclaim the rest: bump the counter and return to pending for another try.
  execute format(
    'update public.%I
        set status = ''pending'',
            %I = coalesce(%I, 0) + 1,
            updated_at = now()
      where status = ''processing''
        and claimed_at < $1
        and coalesce(%I, 0) < $2',
    p_table, counter_col, counter_col, counter_col
  ) using p_stuck_before, p_max_attempts;

  return failed_count;
end
$$;

revoke all on function public.reclaim_stuck_scheduled_posts(text, timestamptz, integer) from public;
grant execute on function public.reclaim_stuck_scheduled_posts(text, timestamptz, integer)
  to authenticated, service_role;
