-- 337_integrations_twitter_scopes.sql
--
-- What X actually granted, so we know before we try.
--
-- Posting an image to X needs the `media.write` scope, and a scope is fixed at
-- authorization time: refreshing a token re-issues the SAME grant. So every
-- connection made before media.write was added to the request has a token that
-- cannot upload, and no amount of retrying changes that. Those creators have to
-- reconnect X once.
--
-- The token exchange and the refresh both hand back a `scope` string. Storing
-- it lets a post know up front whether attaching an image is even possible, so
-- it can say "reconnect X to post images" instead of downloading 5 MB and
-- collecting a 403.
--
-- Nullable, and MEANT to be null for a while: every existing row has no
-- recorded grant, which lib/x-media reads as "unknown" and handles by trying
-- the upload and reporting whatever X says. The column is a shortcut, never a
-- gate.
--
-- Not a secret. It is a list of permission names, so it is deliberately absent
-- from INTEGRATION_SECRET_COLUMNS and stored in the clear, which also means a
-- SQL query can answer "who still needs to reconnect" without decryption.
--
-- Safe to run twice.

alter table public.integrations
  add column if not exists twitter_scopes text;

comment on column public.integrations.twitter_scopes is
  'Space-separated OAuth scopes X granted at connect time. Used to tell whether this token can upload post images (media.write) before attempting one. Null = connected before we recorded it. See lib/x-media.ts';
