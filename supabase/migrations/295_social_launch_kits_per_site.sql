-- 295 — Social Launch Kit per site (per profile), not per user.
--
-- A multi-site creator has a distinct brand per site (name, colors, bios), but
-- the Launch Kit was keyed (user_id, platform) — one slot per platform for the
-- whole account — so a second profile couldn't get its own kit, and the one-shot
-- lock blocked regenerating for it. Scope the kit to the active site so each
-- profile gets its own. The kit already personalizes from the active site's
-- identity (brand_snapshot swap), so only the storage key needed to change.

alter table public.social_launch_kits
  add column if not exists site_id uuid references public.wordpress_sites(id) on delete cascade;

-- Backfill existing kits onto the creator's default site so nobody loses a saved kit.
update public.social_launch_kits k
set site_id = w.id
from public.wordpress_sites w
where w.user_id = k.user_id and w.is_default = true and k.site_id is null;

-- One kit per (user, site, platform). Replaces the old (user, platform) primary
-- key. coalesce keeps legacy null-site rows (creators with no wordpress_sites row)
-- unique per (user, platform).
alter table public.social_launch_kits drop constraint if exists social_launch_kits_pkey;
create unique index if not exists social_launch_kits_user_site_platform_uidx
  on public.social_launch_kits (user_id, coalesce(site_id, '00000000-0000-0000-0000-000000000000'::uuid), platform);

notify pgrst, 'reload schema';
