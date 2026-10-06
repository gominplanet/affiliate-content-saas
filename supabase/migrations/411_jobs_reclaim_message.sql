-- Migration 411: the stuck-post message members read has no dash in it.
--
-- reclaim_stuck_scheduled_posts (migration 249) fails a scheduled post that
-- kept dying mid-publish, and writes a message the scheduled queue shows the
-- member. That message broke its sentence with an em dash. Same function, same
-- logic, same '[auto-failed]' prefix (lib/channel-health keys on it so these
-- rows never count toward a dead channel); only the wording changes.
--
-- Safe to run twice.

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
  if p_table = 'scheduled_posts' then
    counter_col := 'retry_count';
  elsif p_table in ('deal_scheduled_posts', 'amazon_scheduled_posts') then
    counter_col := 'attempts';
  else
    raise exception 'reclaim_stuck_scheduled_posts: invalid table %', p_table;
  end if;

  execute format(
    'update public.%I
        set status = ''failed'',
            error_message = ''[auto-failed] Publishing kept timing out, so it stopped after '' || %L || '' tries. Check the channel, then schedule it again.'',
            updated_at = now()
      where status = ''processing''
        and claimed_at < $1
        and coalesce(%I, 0) >= $2',
    p_table, p_max_attempts, counter_col
  ) using p_stuck_before, p_max_attempts;
  get diagnostics failed_count = row_count;

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

notify pgrst, 'reload schema';
