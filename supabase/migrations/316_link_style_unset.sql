-- 316 — "no link style chosen" has to stay tellable apart from "chose Direct".
--
-- Migration 274 added blog_social_link_mode as `not null default 'direct'`.
-- On a database where 274 has not run yet (which is where this matters), that
-- default lands on EVERY existing row at once and turns a platform-wide "nobody
-- was ever asked" into a platform-wide "everyone chose Direct". After that
-- nothing can tell the two apart: not the resolver, which reads an unset style
-- against the creator's stored credentials, and not the dashboard, which asks
-- creators who have not picked. Both would go quiet and every creator would be
-- pinned to plain Amazon links, which is the exact bug 274 is being run to fix.
--
-- So the column is nullable with no default, and null means what it says: this
-- creator has not chosen. Three groups come out of this:
--
--   Geniuslink connected  → 'geniuslink'. They had it working before the
--                           chooser existed; nobody stores paid API credentials
--                           they do not want used, and this is the group whose
--                           links quietly went out untracked.
--   Passport on           → left alone. Switching Passport on IS their choice,
--                           it wins over this column anyway, and writing a paid
--                           per-click service under it would be a bill they
--                           never agreed to if they ever switch Passport off.
--   everyone else         → null. They get asked, and Direct in the meantime.
--
-- Idempotent, and safe whether or not 274 has been applied.

alter table public.integrations
  add column if not exists blog_social_link_mode text,
  add column if not exists bitly_access_token text;

alter table public.integrations
  alter column blog_social_link_mode drop default;
alter table public.integrations
  alter column blog_social_link_mode drop not null;

-- Restore the creators who had Geniuslink connected before the chooser existed.
update public.integrations
   set blog_social_link_mode = 'geniuslink'
 where (blog_social_link_mode is null or blog_social_link_mode = 'direct')
   and passport_links_enabled is not true
   and (
     wrap_blog_geniuslink is true
     or (nullif(btrim(geniuslink_api_key), '') is not null
         and nullif(btrim(geniuslink_api_secret), '') is not null)
   );

-- Give everyone else their silence back. Only reachable for a row still sitting
-- on 274's backfilled default with nothing behind it: no Geniuslink, no Bitly,
-- no Passport, no legacy flag. Such a row cannot have been a decision, because
-- the screen that records one also stores something alongside it.
update public.integrations
   set blog_social_link_mode = null
 where blog_social_link_mode = 'direct'
   and wrap_blog_geniuslink is not true
   and passport_links_enabled is not true
   and nullif(btrim(geniuslink_api_key), '') is null
   and nullif(btrim(bitly_access_token), '') is null;

-- The check still holds for the three real values; null passes it untouched.
alter table public.integrations
  drop constraint if exists integrations_blog_social_link_mode_chk;
alter table public.integrations
  add constraint integrations_blog_social_link_mode_chk
  check (blog_social_link_mode is null
         or blog_social_link_mode in ('direct', 'geniuslink', 'bitly'));

comment on column public.integrations.blog_social_link_mode is
  'The creator''s chosen link style: direct | geniuslink | bitly. NULL means they have not chosen one, which the resolver reads against their stored credentials and the dashboard asks them to settle.';

notify pgrst, 'reload schema';
