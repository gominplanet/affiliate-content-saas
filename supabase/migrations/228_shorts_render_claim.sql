-- 228 — Atomic monthly cap for Clip Factory renders.
--
-- The render route used to check-then-act: count shorts_render rows, then later
-- insert the usage row after the render finished. Concurrent renders could all
-- pass the count check before any row landed, blowing past SHORTS_MONTHLY_CAP.
--
-- This function makes the check + reservation atomic under a per-user advisory
-- lock. It runs as a single RPC = a single transaction, so the xact-scoped lock
-- is pooling-safe (works under pgbouncer transaction mode). It returns the
-- reservation row's id so the caller can refund (delete) it if the render fails.
--
-- The reservation lives in ai_usage as feature='shorts_render' with images=0
-- (zero cost) — the monthly cap counts these. Real render cost is logged
-- separately as feature='shorts_render_cost' so it never double-counts the cap.
--
-- SECURITY: the user id is taken from auth.uid() inside the function, NOT from a
-- caller-supplied argument, so a caller can't reserve against another user's cap.

create or replace function claim_shorts_render(
  p_cap integer,
  p_since timestamptz,
  p_tier text
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_count integer;
  v_id uuid;
begin
  if v_user is null then
    return null;
  end if;

  -- Serialize concurrent claims for this user (released at transaction end).
  perform pg_advisory_xact_lock(hashtext('shorts_render:' || v_user::text));

  select count(*) into v_count
    from ai_usage
    where user_id = v_user
      and feature = 'shorts_render'
      and created_at >= p_since;

  if p_cap is not null and v_count >= p_cap then
    return null;  -- over cap
  end if;

  insert into ai_usage (user_id, feature, model, tier, input_tokens, output_tokens, web_searches, images)
    values (v_user, 'shorts_render', 'reserved', p_tier, 0, 0, 0, 0)
    returning id into v_id;

  return v_id;
end;
$$;

revoke all on function claim_shorts_render(integer, timestamptz, text) from public;
grant execute on function claim_shorts_render(integer, timestamptz, text) to authenticated, service_role;

notify pgrst, 'reload schema';
