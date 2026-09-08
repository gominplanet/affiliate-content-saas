-- © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
--
-- Stop handing a Virtual Assistant the owner's credentials.
--
-- Migration 116 widened SELECT on five tables so an accepted VA sees the
-- owner's workspace instead of an empty one. Four of those are content
-- (youtube_videos, blog_posts, brand_profiles, wordpress_sites) and that is
-- exactly the point of the feature. The fifth is `integrations`, which is not
-- content: it is the row holding every OAuth token, the Geniuslink API key and
-- secret, and the Hostinger API key.
--
-- The note in 116 said writes were blocked and the settings pages were route
-- blocked. Both are true and neither helps here. A route block hides a PAGE. A
-- VA is a fully authenticated user and can read the table directly from the
-- browser with the anon key, no page involved. Most of those columns are
-- encrypted at rest so a reader gets ciphertext, but not all of them were, and
-- relying on "which columns happen to be encrypted" is not an access rule.
--
-- Nothing depends on this branch today. Every dashboard query filters by
-- .eq('user_id', user.id), which is the VA's OWN id, so the owner branch of the
-- policy is never exercised by the client. Dropping it changes no behaviour and
-- removes the read.
--
-- When VA resource inheritance is finished, integrations should come back as a
-- view exposing the columns a VA legitimately needs (tier, wordpress_url,
-- onboarding state, whitelabel), never the credential columns. Publishing on
-- the owner's behalf belongs in a server route using the service role, where
-- the token is used and never handed to the browser.
--
-- Safe to run twice. Both drops are `if exists` and the create is guarded, so a
-- second run is a no-op rather than a "policy already exists" error. That guard
-- matters more than usual here: if the create failed after the drop had
-- committed, integrations would be left with no SELECT policy at all and every
-- user would stop being able to read their own row.

do $$
begin
  -- The widened branch from migration 116. This is the one being removed.
  drop policy if exists "VAs see owner integrations" on public.integrations;

  -- Replace it with the owner-only read, which is what every client query
  -- actually asks for. Dropped first by name so re-running cannot collide.
  drop policy if exists "Users see own integrations" on public.integrations;
  create policy "Users see own integrations"
    on public.integrations
    for select
    to authenticated
    using (user_id = auth.uid());
end $$;

comment on table public.integrations is
  'Per-user credentials and connection state. SELECT is the owner''s own row ONLY: this table holds OAuth tokens and API keys, so it is deliberately excluded from the VA resource sharing in migration 116. A VA acting for an owner must go through a server route using the service role, so the credential is used server-side and never reaches a browser.';
