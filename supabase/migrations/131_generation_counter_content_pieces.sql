-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 131 — Generation quota = CONTENT PIECES only.
--
-- Pricing model decision (2026-06-15): "1 = one content piece."
--   • A content piece = one NEW primary article (review / comparison / guide /
--     deal / campaign / walmart) — each inserts exactly one blog_posts row.
--   • Co-Pilot thumbnail + metadata are FREE enrichment of a piece. They no
--     longer decrement this count (they're bounded by the monthly $-ceiling
--     via spendGate instead — see the generate-thumbnail / generate-metadata
--     routes). This removes the old 3× over-count where a single Co-Pilot→blog
--     chain burned blog(1) + thumbnail(1) + metadata(1) = 3 of the bucket.
--   • A rebuild / refresh of an existing piece is free — it UPDATEs the row,
--     it doesn't INSERT a new one, so it never adds to the count.
--   • Social fan-out is free (publish routes never touch this quota).
--
-- This change can only LOOSEN a user's count vs migration 101 (it drops the
-- thumbnail + metadata sums), so it can't restrict anyone mid-cycle. The
-- $-ceiling remains the true cost cap. Same signature + advisory lock as 101.
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.try_consume_generation_quota(
  p_user uuid,
  p_monthly integer,            -- TIERS[tier].postsPerMonth, NULL = unlimited
  p_window_start timestamptz,   -- billingWindow.startISO
  p_units integer default 1
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  piece_cnt int;
begin
  -- Per-user advisory lock — serialize concurrent generates so the count each
  -- sees reflects all previously-committed pieces.
  perform pg_advisory_xact_lock(hashtext('generation_quota:' || p_user::text));

  -- No cap → always allow (admin tier).
  if p_monthly is null then
    return true;
  end if;

  -- Count NEW primary content pieces in the billing window. Every content type
  -- (blog / comparison / guide / deal / campaign / walmart) inserts one
  -- blog_posts row, so this single count covers them all. Co-Pilot thumbnail +
  -- metadata are intentionally NOT counted here (free enrichment, $-gated).
  select count(*) into piece_cnt
    from public.blog_posts
    where user_id = p_user and published_at >= p_window_start;

  return (piece_cnt + coalesce(p_units, 1)) <= p_monthly;
end
$$;

revoke all on function public.try_consume_generation_quota(uuid, integer, timestamptz, integer) from public;
grant execute on function public.try_consume_generation_quota(uuid, integer, timestamptz, integer)
  to authenticated, service_role;

comment on function public.try_consume_generation_quota(uuid, integer, timestamptz, integer) is
  'Per-user monthly quota = COUNT of new content pieces (blog_posts rows) in the '
  'billing window. Co-Pilot thumbnail + metadata are free enrichment ($-ceiling '
  'bounded, not counted here); rebuilds are free (no new row). Returns true if '
  '(pieces + p_units) <= p_monthly. Migration 131 superseded the 101 blog+thumb+meta sum.';
