-- © 2026 Gominplanet / MVP Affiliate
--
-- Phase 2 — VA RESOURCE SHARING (read side).
--
-- Phase 1 (already live): VAs can be invited + accept + appear in the
-- owner's roster. Helpers in lib/agency.ts compute "effective owner".
-- BUT: every resource query (Supabase client AND server-side) was
-- filtering by user_id = auth.uid(), so a VA logging in saw an empty
-- workspace — no videos, no posts, no brand profile.
--
-- Phase 2 fixes the READ side by extending the existing user_id RLS
-- policies on the user-scoped resource tables. The new policy says:
--
--   "A row is visible to the authenticated user when:
--      user_id = auth.uid()  (owner / themselves), OR
--      user_id IS IN the owner_user_ids that auth.uid() is an
--      accepted member of."
--
-- This makes EVERY client-side .from('table').select('...').eq('user_id', X)
-- query naturally return the owner's rows when an accepted VA queries
-- WITHOUT touching application code. The server-side API routes that
-- explicitly filter by .eq('user_id', user.id) will be updated separately
-- to call getOwnerUserId(user.id) so writes also land under the owner.
--
-- Scope: SELECT only. INSERT/UPDATE/DELETE policies are NOT widened —
-- VAs must go through API routes that enforce permission checks for
-- writes. This is a deliberate guardrail: a VA can't directly write
-- arbitrary rows under the owner via the Supabase client.
--
-- Tables widened:
--   youtube_videos     — Library video list, transcript, metadata
--   blog_posts         — Library posts list, generation results
--   brand_profiles     — author name, voice, niches (banner already
--                        blocks /brand for VAs, but reads from helpers)
--   integrations       — OAuth tokens, geniuslink keys (writes blocked)
--   wordpress_sites    — multi-site row list (read needed for site picker)
--
-- The agency_members lookup is parameterized by the calling auth.uid()
-- so a VA only sees the owners they're an ACTIVE (non-revoked) member of.

-- ── Helper: is the calling user an accepted member of `target_owner`? ──
-- Pulled into a function so the policy expressions stay short + readable.
create or replace function public.is_accepted_member_of(target_owner uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from agency_members
    where member_user_id = auth.uid()
      and owner_user_id  = target_owner
      and revoked_at is null
  );
$$;

comment on function public.is_accepted_member_of(uuid) is
  'True when the calling auth.uid() is an accepted (non-revoked) member of the given owner_user_id. Used by RLS SELECT policies to allow VAs to read their owner''s resources.';

grant execute on function public.is_accepted_member_of(uuid) to authenticated;

-- ── youtube_videos ────────────────────────────────────────────────────
drop policy if exists "VAs see owner videos" on public.youtube_videos;
create policy "VAs see owner videos"
on public.youtube_videos
for select
to authenticated
using (
  user_id = auth.uid()
  or is_accepted_member_of(user_id)
);

-- ── blog_posts ────────────────────────────────────────────────────────
drop policy if exists "VAs see owner posts" on public.blog_posts;
create policy "VAs see owner posts"
on public.blog_posts
for select
to authenticated
using (
  user_id = auth.uid()
  or is_accepted_member_of(user_id)
);

-- ── brand_profiles ────────────────────────────────────────────────────
-- VAs need this for content generation (voice profile, niches, author
-- name) even though the /brand page is route-blocked. The block prevents
-- editing; this allows reading.
drop policy if exists "VAs see owner brand" on public.brand_profiles;
create policy "VAs see owner brand"
on public.brand_profiles
for select
to authenticated
using (
  user_id = auth.uid()
  or is_accepted_member_of(user_id)
);

-- ── integrations ──────────────────────────────────────────────────────
-- Contains OAuth tokens (YouTube, Instagram, etc.) + Geniuslink keys +
-- Amazon Associates tag. VAs need to USE these for content generation
-- (publishing to WordPress, getting Geniuslinks). The /setup-integrations
-- + billing pages are route-blocked, preventing modification.
drop policy if exists "VAs see owner integrations" on public.integrations;
create policy "VAs see owner integrations"
on public.integrations
for select
to authenticated
using (
  user_id = auth.uid()
  or is_accepted_member_of(user_id)
);

-- ── wordpress_sites ───────────────────────────────────────────────────
-- Multi-site Pro feature. VA needs to see the site list to pick which
-- site to publish to.
drop policy if exists "VAs see owner sites" on public.wordpress_sites;
create policy "VAs see owner sites"
on public.wordpress_sites
for select
to authenticated
using (
  user_id = auth.uid()
  or is_accepted_member_of(user_id)
);
