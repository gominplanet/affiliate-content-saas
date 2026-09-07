-- © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
--
-- A switch to turn ONE link off.
--
-- Every creator's Passport links live on mvpl.ink, so they share one
-- reputation. If a single account points links at something that gets the
-- domain blocklisted, every other creator's published links stop working, with
-- no warning and nothing they did wrong.
--
-- Without a per-row switch the only lever against one bad link is taking the
-- whole domain down, which punishes everybody for one account. This column is
-- that lever: kill one link, or one account's links, and nobody else notices.
--
-- Defaults to false so every existing link keeps redirecting. A nullable column
-- read as "off" would have silently killed every link ever published, which is
-- the one outcome worse than the problem it is here to solve.

alter table if exists public.passport_links
  add column if not exists disabled boolean not null default false;

comment on column public.passport_links.disabled is
  'Moderation switch. true = /go/<code> stops redirecting and sends the visitor to the main site instead. Per row so one bad link, or one account''s links, can be stopped without affecting anyone else on the shared domain.';

-- Finding a user's links to disable them, and counting recent mints for the
-- rate limit, both read (user_id, created_at). That index already exists from
-- migration 282 (passport_links_user_idx), so nothing more is needed here.
