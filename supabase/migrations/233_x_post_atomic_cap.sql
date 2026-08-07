-- 233 — Atomic monthly cap for X (Twitter) posts.
--
-- X is the one social channel with a real per-post cost ($0.20 on X's Pay Per
-- Use plan), so it's metered to X_MONTHLY_CAP posts per billing period. The old
-- flow was check-then-act: checkXPostCap() counted x_post rows, then recordXPost()
-- inserted the counter row AFTER the tweet succeeded. Several X posts for one user
-- in the same cron tick all read the same pre-post count, all passed, and all
-- posted — blowing past the cap and the X spend it protects.
--
-- This function makes the check + reservation atomic under a per-user advisory
-- lock (transaction-scoped, so it's safe under pgbouncer transaction pooling).
-- It reserves by inserting the x_post counter row up front and returns its id;
-- the caller REFUNDS (deletes) that row if the tweet fails, so a failed attempt
-- doesn't burn a slot. On success the row simply stays — no separate record step.
--
-- SECURITY: the effective user is coalesce(auth.uid(), p_user_id). An
-- authenticated caller is pinned to their own auth.uid() (p_user_id is ignored),
-- so they can't reserve against someone else's cap. Only the service role (cron,
-- deal-social-publish) has a null auth.uid() and may pass p_user_id explicitly.

create or replace function claim_x_post(
  p_user_id uuid,
  p_cap integer,
  p_since timestamptz,
  p_tier text
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := coalesce(auth.uid(), p_user_id);
  v_count integer;
  v_id uuid;
begin
  if v_user is null then
    return null;
  end if;

  -- Serialize concurrent claims for this user (released at transaction end).
  perform pg_advisory_xact_lock(hashtext('x_post:' || v_user::text));

  select count(*) into v_count
    from ai_usage
    where user_id = v_user
      and feature = 'x_post'
      and created_at >= p_since;

  if p_cap is not null and v_count >= p_cap then
    return null;  -- over cap
  end if;

  -- Reserve the slot now (same row shape recordXPost used to write on success).
  insert into ai_usage (user_id, feature, model, tier, input_tokens, output_tokens, web_searches, images)
    values (v_user, 'x_post', 'twitter-api', p_tier, 0, 0, 0, 1)
    returning id into v_id;

  return v_id;
end;
$$;

revoke all on function claim_x_post(uuid, integer, timestamptz, text) from public;
grant execute on function claim_x_post(uuid, integer, timestamptz, text) to authenticated, service_role;

notify pgrst, 'reload schema';
