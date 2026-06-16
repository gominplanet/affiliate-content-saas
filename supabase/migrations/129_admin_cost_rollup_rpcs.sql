-- 129 — admin cost-dashboard rollup RPCs
--
-- Replaces the /api/admin/costs route's three .limit(100000) table scans + the
-- in-JS aggregation loop with DB-side GROUP BY. Cost is still computed in TS
-- (lib/ai-usage PRICING) from the grouped token sums — cost is linear per
-- model, so summing tokens then pricing == pricing per-row then summing (exact
-- parity), and the pricing table stays single-sourced in TS (no SQL drift).
--
-- EXECUTE is restricted to service_role: these return cross-user aggregates and
-- are only ever called by the admin-only costs route via the service-role
-- client, never from a user's browser session.
--
-- Idempotent: create-or-replace + revoke/grant are safe to re-run.

create or replace function public.admin_ai_cost_rollup(p_since timestamptz)
returns table (
  tier text, feature text, model text,
  input_tokens bigint, output_tokens bigint, web_searches bigint, images bigint,
  calls bigint
) language sql stable as $$
  select
    coalesce(u.tier, 'unknown'),
    coalesce(u.feature, 'unknown'),
    coalesce(u.model, 'unknown'),
    coalesce(sum(u.input_tokens), 0)::bigint,
    coalesce(sum(u.output_tokens), 0)::bigint,
    coalesce(sum(u.web_searches), 0)::bigint,
    coalesce(sum(u.images), 0)::bigint,
    count(*)::bigint
  from public.ai_usage u
  where u.created_at >= p_since
  group by u.tier, u.feature, u.model
$$;

create or replace function public.admin_ai_active_users(p_since timestamptz)
returns table (tier text, users bigint)
language sql stable as $$
  select coalesce(u.tier, 'unknown'), count(distinct u.user_id)::bigint
  from public.ai_usage u
  where u.created_at >= p_since
  group by u.tier
$$;

create or replace function public.admin_posts_by_tier(p_since timestamptz)
returns table (tier text, posts bigint)
language sql stable as $$
  select coalesce(i.tier, 'other'), count(*)::bigint
  from public.blog_posts b
  left join public.integrations i on i.user_id = b.user_id
  where b.created_at >= p_since
  group by i.tier
$$;

create or replace function public.admin_paying_users()
returns table (tier text, users bigint)
language sql stable as $$
  select i.tier, count(*)::bigint
  from public.integrations i
  where i.tier in ('creator', 'studio', 'pro')
  group by i.tier
$$;

-- Lock down: admin aggregates, service-role only.
revoke all on function public.admin_ai_cost_rollup(timestamptz)   from public;
revoke all on function public.admin_ai_active_users(timestamptz)  from public;
revoke all on function public.admin_posts_by_tier(timestamptz)    from public;
revoke all on function public.admin_paying_users()                from public;
grant execute on function public.admin_ai_cost_rollup(timestamptz)   to service_role;
grant execute on function public.admin_ai_active_users(timestamptz)  to service_role;
grant execute on function public.admin_posts_by_tier(timestamptz)    to service_role;
grant execute on function public.admin_paying_users()                to service_role;
