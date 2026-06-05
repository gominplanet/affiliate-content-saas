-- 094_wordpress_sites_pro_cap_10.sql
-- ─────────────────────────────────────────────────────────────────────────
-- Raise the Pro-tier WordPress site cap from 5 → 10 to match the
-- 2026-06-04 tier restructure (lib/tier.ts → TIERS.pro.sites = 10).
--
-- Why: the original trigger from migration 085 hard-coded `> 5` in the
-- SQL, so even after lib/wordpress-sites.ts started reading the new
-- TIERS.sites value (10) the DB layer would still reject the 6th INSERT.
-- This migration replaces the trigger function body. No data change.

create or replace function public.enforce_wordpress_sites_per_user_cap()
returns trigger as $$
begin
  if (select count(*) from public.wordpress_sites where user_id = new.user_id) > 10 then
    raise exception 'Pro plan supports up to 10 WordPress sites per account';
  end if;
  return new;
end;
$$ language plpgsql;

-- Trigger itself (wordpress_sites_cap_trigger) is unchanged from 085,
-- so no DROP+CREATE needed — replacing the function rewires the
-- existing trigger automatically.
