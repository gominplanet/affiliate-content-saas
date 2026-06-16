-- 134 — pre-flood performance hardening
--
-- (a) Per-user monthly AI-cost rollup RPC. The spend circuit-breaker
--     (lib/ai-spend.ts) was fetching EVERY ai_usage row for the month and
--     summing in JS — on the critical path of every generation and the billing
--     meter. ai_usage is the fastest-growing table, so that read is heaviest
--     exactly during the "generate all night" runaway the breaker exists to
--     catch. This mirrors migration 129's admin rollup but scoped to one user:
--     the DB does the GROUP BY (≤~20 model rows), cost is still priced in TS
--     from the grouped token sums. Cost is linear per model, so summing tokens
--     then pricing == pricing per row then summing (exact parity), and the
--     PRICING table stays single-sourced in lib/ai-usage (no SQL drift).
--
-- (b) Partial composite index for the support-ticket half of the notification
--     bell poll (answered + unseen, per user, newest first).
--
-- Idempotent: create-or-replace + create index if not exists + revoke/grant are
-- all safe to re-run.

create or replace function public.user_ai_cost_rollup(p_user uuid, p_since timestamptz)
returns table (
  model text,
  input_tokens bigint, output_tokens bigint, web_searches bigint, images bigint
) language sql stable as $$
  select
    coalesce(u.model, 'unknown'),
    coalesce(sum(u.input_tokens), 0)::bigint,
    coalesce(sum(u.output_tokens), 0)::bigint,
    coalesce(sum(u.web_searches), 0)::bigint,
    coalesce(sum(u.images), 0)::bigint
  from public.ai_usage u
  where u.user_id = p_user and u.created_at >= p_since
  group by u.model
$$;

-- Called server-side only (service-role client in lib/ai-spend). Restrict
-- EXECUTE so it can't be invoked from a browser session.
revoke all on function public.user_ai_cost_rollup(uuid, timestamptz) from public;
revoke all on function public.user_ai_cost_rollup(uuid, timestamptz) from anon;
revoke all on function public.user_ai_cost_rollup(uuid, timestamptz) from authenticated;
grant execute on function public.user_ai_cost_rollup(uuid, timestamptz) to service_role;

-- Notification bell: support_tickets answered-but-unseen, per user, newest
-- first (matches the predicate in /api/notifications). Partial → tiny.
create index if not exists support_tickets_bell_idx
  on public.support_tickets (user_id, responded_at desc)
  where status = 'answered' and response_seen = false;
