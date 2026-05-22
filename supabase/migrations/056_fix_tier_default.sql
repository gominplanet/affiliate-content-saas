-- 056 — Fix the integrations.tier column DEFAULT + re-remap stragglers.
--
-- 053 remapped EXISTING rows (free→trial, etc.) but left the column DEFAULT
-- as the legacy 'free'. So every account created AFTER 053 was inserted with
-- tier='free' again — which is no longer a valid tier in the 2-tier model, so
-- TIERS['free'] is undefined and blog generation crashed with
-- "cannot read properties of undefined (reading 'lifetimeMax')".
--
-- Fix the default so new rows are 'trial', and re-remap any rows that slipped
-- through with a legacy value. Idempotent.

alter table public.integrations alter column tier set default 'trial';

update public.integrations set tier = 'trial'   where tier = 'free';
update public.integrations set tier = 'creator' where tier in ('starter', 'growth');
update public.integrations set tier = 'trial'   where tier is null;
