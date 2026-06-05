-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 101 — Shared generation counter (unified quota across blog,
-- thumbnail, metadata generations).
--
-- The 2026-06-04 tier restructure declared one "Generations" bundle:
-- Creator 20/mo, Studio 60/mo, Pro 200/mo. The tier values are mirrored
-- across postsPerMonth / thumbnailsPerMonth / metadataGensPerMonth, but
-- each route enforces its cap independently — so a Creator can burn
-- 20 blogs + 20 thumbnails + 20 metadata = 60 ops/mo instead of the
-- intended 20. This RPC closes the gap by counting all three sources in
-- a single transaction-locked check.
--
-- Counting strategy: union of blog_posts (since window) + ai_usage rows
-- for the thumbnail + metadata "primary feature" names. No new counter
-- column needed — the rows already exist; we just need to sum them
-- under a per-user lock so two concurrent generates can't both squeak
-- past the cap.
--
-- Forward-compatible: try_consume_post_quota() stays around so callers
-- that haven't migrated yet keep working. Recommend migrating all
-- three (blog/generate, generate-thumbnail, generate-metadata) in the
-- same release as this migration so the new cap is enforced
-- consistently across the surface.
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.try_consume_generation_quota(
  p_user uuid,
  p_monthly integer,            -- TIERS[tier].generationsPerMonth, NULL = unlimited
  p_window_start timestamptz,   -- billingWindow.startISO
  p_units integer default 1     -- thumbnails support N variants per call
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  blog_cnt int;
  thumb_cnt int;
  meta_cnt int;
  total_cnt int;
begin
  -- Per-user advisory lock — held until the surrounding transaction ends.
  -- Two concurrent generates serialize through this point so the count
  -- they each see reflects all previously-committed rows.
  perform pg_advisory_xact_lock(hashtext('generation_quota:' || p_user::text));

  -- No cap → always allow (admin tier).
  if p_monthly is null then
    return true;
  end if;

  -- Count generations from the three sources within the billing window.
  -- Each source uses its primary feature so the same logical generation
  -- is never double-counted even if it fires multiple model calls.
  select count(*) into blog_cnt
    from public.blog_posts
    where user_id = p_user and published_at >= p_window_start;

  select count(*) into thumb_cnt
    from public.ai_usage
    where user_id = p_user
      and created_at >= p_window_start
      and feature in (
        'yt_thumb_gptimage',
        'yt_thumb_kontext_image',
        'yt_thumb_flux_image',
        'yt_thumb_flux_lora_image',
        'yt_thumb_nanobanana_image',
        'yt_thumb_ideogram_image'
      );

  select count(*) into meta_cnt
    from public.ai_usage
    where user_id = p_user
      and created_at >= p_window_start
      and feature = 'yt_meta_title_strategist';

  total_cnt := blog_cnt + thumb_cnt + meta_cnt;
  return (total_cnt + coalesce(p_units, 1)) <= p_monthly;
end
$$;

revoke all on function public.try_consume_generation_quota(uuid, integer, timestamptz, integer) from public;
grant execute on function public.try_consume_generation_quota(uuid, integer, timestamptz, integer)
  to authenticated, service_role;

comment on function public.try_consume_generation_quota(uuid, integer, timestamptz, integer) is
  'Unified per-user check across blog, YouTube thumbnail, and YouTube '
  'metadata generations. Returns true if (current sum + p_units) <= p_monthly. '
  'Wraps reads in a per-user advisory lock to serialize concurrent generates. '
  'Counts already-committed rows from blog_posts + ai_usage (no new counter '
  'column needed). Pair with lib/tier.ts allowedGenerationsPerMonth() helper.';
