-- 069 — Google Search Console OAuth connection
--
-- Stores the creator's GSC connection so MVP can surface indexing status,
-- search performance, and the REAL queries that find each post (a vidIQ-free
-- keyword source). Read-only scope (webmasters.readonly). Mirrors the
-- youtube_oauth_* columns on integrations.
--
-- gsc_property is the verified Search Console property the tokens map to, in
-- GSC's own form: a domain property 'sc-domain:gominreviews.com' or a URL
-- prefix 'https://gominreviews.com/'. Resolved at connect time by matching the
-- user's wordpress_url against their verified properties.

alter table public.integrations
  add column if not exists gsc_oauth_access_token  text,
  add column if not exists gsc_oauth_refresh_token text,
  add column if not exists gsc_oauth_token_expiry  bigint,
  add column if not exists gsc_property            text;
