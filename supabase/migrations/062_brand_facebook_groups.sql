-- Migration 062: Facebook Groups saved on the brand profile
--
-- Stores the user's Facebook Group links (groups they admin) so the
-- Library / Social Push "Facebook" flow can list them for one-click
-- manual sharing — Meta's API can't publish to Groups, only Pages.
--
-- Shape: jsonb array of { "name": string, "url": string }.

alter table public.brand_profiles
  add column if not exists facebook_groups jsonb not null default '[]'::jsonb;
