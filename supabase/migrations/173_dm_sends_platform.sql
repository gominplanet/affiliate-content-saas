-- Migration 173 — tag ig_dm_sends rows with the platform, now that Facebook
-- Pages share the same comment→DM engine as Instagram. comment_id is still the
-- unique dedupe key (FB + IG comment ids never collide), so this is purely for
-- auditing which channel a send came from.
alter table public.ig_dm_sends add column if not exists platform text not null default 'instagram';
