-- 296 — Seed the operator's Passport Link for the TRYBE Recommended Tool.
--
-- The Recommended Tools list cloaks every partner link. TRYBE is now cloaked
-- through OUR Passport redirect (/go/trybe) instead of a third-party wrapper, so
-- clicks land in the operator's Passport analytics and the destination can be
-- changed later without touching the app. This inserts ONE operator-owned
-- Passport link with a fixed, readable code that the UI hardcodes.
--
-- Owned by the operator account (looked up by email). Idempotent: re-running just
-- refreshes the destination/label. If the email doesn't match a user, this is a
-- safe no-op (adjust the email and re-run).

insert into public.passport_links (code, user_id, site_id, asin, destination_url, source, label)
select 'trybe', u.id, null, null, 'https://jointrybe.com/r/HTLEJE47', 'recommended-tools', 'TRYBE'
from auth.users u
where lower(u.email) = 'gominunlimited@gmail.com'
on conflict (code) do update
  set destination_url = excluded.destination_url,
      source          = excluded.source,
      label           = excluded.label;

notify pgrst, 'reload schema';
