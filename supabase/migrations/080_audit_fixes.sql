-- 080 — Audit pass: serialize quota check, atomic broadcast counters, rate-limit index
--
-- Three small structural changes surfaced by the 2026-05-29 code audit:
--
-- 1. try_consume_post_quota() — Postgres-side advisory-lock + count + decision
--    so two concurrent /api/blog/generate requests can't both pass the cap
--    check and both insert. Replaces the check-then-write pattern in
--    lib/tier.ts's checkUsageLimit. The route still calls .from('blog_posts')
--    .insert() afterwards — this just gates whether the insert is allowed.
--
-- 2. increment_broadcast_counter() — atomic UPDATE for newsletter_broadcasts
--    delivery counters. /api/newsletter/resend-webhook acknowledges in its
--    own comments that two concurrent 'delivered' events lose an increment;
--    Postgres-side UPDATE col = col + 1 fixes it without changing the
--    webhook handler shape.
--
-- 3. Partial index on newsletter_subscribers (signup_ip_hash, created_at)
--    so /api/newsletter/subscribe can rate-limit by source IP cheaply
--    (count signups in the last hour per ip-hash).
--
-- All three are forward-compatible — old callers keep working until the
-- routes are updated to call the new functions.

-- ── 1. Serialized post-quota gate ───────────────────────────────────────────
create or replace function public.try_consume_post_quota(
  p_user uuid,
  p_lifetime integer,          -- TIERS[tier].lifetimeMax, NULL = no lifetime cap
  p_monthly integer,           -- TIERS[tier].postsPerMonth, NULL = no monthly cap
  p_window_start timestamptz   -- billingWindow.startISO
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  cnt int;
begin
  -- Per-user advisory lock — held until the surrounding transaction ends.
  -- Two concurrent generates serialize through this point so the count
  -- they each see reflects all previously-committed inserts.
  perform pg_advisory_xact_lock(hashtext('post_quota:' || p_user::text));

  if p_lifetime is not null then
    select count(*) into cnt from public.blog_posts where user_id = p_user;
    return cnt < p_lifetime;
  end if;

  if p_monthly is not null then
    select count(*) into cnt
      from public.blog_posts
      where user_id = p_user and published_at >= p_window_start;
    return cnt < p_monthly;
  end if;

  -- No cap at all (admin tier) → always allow.
  return true;
end
$$;

revoke all on function public.try_consume_post_quota(uuid, integer, integer, timestamptz) from public;
grant execute on function public.try_consume_post_quota(uuid, integer, integer, timestamptz) to authenticated, service_role;

-- ── 2. Atomic broadcast counter increment ──────────────────────────────────
-- We allow-list the column name server-side BEFORE calling, but the function
-- still hard-checks so a misuse can't bump arbitrary columns.
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
    'recipients_clicked'
  ) then
    raise exception 'Invalid counter column: %', p_column;
  end if;

  execute format(
    'update public.newsletter_broadcasts set %I = coalesce(%I, 0) + 1 where id = $1 and user_id = $2',
    p_column, p_column
  ) using p_broadcast_id, p_user;
end
$$;

revoke all on function public.increment_broadcast_counter(uuid, uuid, text) from public;
grant execute on function public.increment_broadcast_counter(uuid, uuid, text) to authenticated, service_role;

-- ── 3. Rate-limit index for newsletter signup IP hashing ───────────────────
-- Used by /api/newsletter/subscribe to count signups per ip-hash in the
-- last hour without scanning the whole subscribers table.
create index if not exists newsletter_subscribers_iphash_recent_idx
  on public.newsletter_subscribers (signup_ip_hash, created_at desc)
  where signup_ip_hash is not null;
