-- © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
--
-- Let a creator rewrite the lines MVP puts in their YouTube descriptions.
--
-- Today they can APPEND (brand_profiles.youtube_description_block) and nothing
-- else. The disclosure, the blog backlink, the sign-off and the collaboration
-- line are MVP's words, hard-coded, in a description published under the
-- creator's own name on their own channel.
--
-- That was tolerable until MVP's boilerplate was wrong. One creator's blog URL
-- printed twice, and his only options were to fix it by hand on every single
-- video or wait for us. He asked "is there a way I can edit the description?".
-- The honest answer was no, not permanently.
--
-- One jsonb column rather than ten text columns: the set of lines will change
-- as the description does, and a key that no longer exists should stop being
-- read rather than need a migration to drop. Shape is { <lineKey>: <text> },
-- and any key absent means "use MVP's default", so an empty object and a null
-- both mean an untouched account.
--
-- Nothing is backfilled and no behaviour changes on deploy: lib/
-- yt-description-lines.ts holds defaults byte-identical to what the route
-- hard-coded, so a creator's descriptions stay the same until they edit one.
--
-- Safe to run twice.

alter table if exists public.brand_profiles
  add column if not exists yt_description_lines jsonb;

comment on column public.brand_profiles.yt_description_lines is
  'Creator overrides for the boilerplate lines MVP writes into YouTube descriptions, as { lineKey: text }. Absent keys use MVP''s default. Values may contain {link} {site} {email} {shop} tokens, filled at generation time. The two disclosure lines are validated before use: an override that no longer reads as a disclosure is ignored and the default stands, because that line is an Amazon Operating Agreement and FTC requirement rather than a preference.';
