-- 292 — Passport Links: named groups (Geniuslink-style link groups).
--
-- Geniuslink's headline organizing feature is "groups": you bucket your links
-- into named groups (by channel, campaign, blog, whatever) and read your clicks
-- segmented by group. This brings the same to Passport Links so creators don't
-- need Geniuslink for it.
--
-- Design: a per-creator `passport_groups` table + a nullable `group_id` on
-- `passport_links`. New links auto-land in a channel group derived from their
-- attribution source (YouTube / Blog / Social / Pinterest / EPC / General), so
-- analytics segment out of the box; creators can rename, delete, or reassign.

create table if not exists public.passport_groups (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  name       text not null,
  created_at timestamptz not null default now()
);
-- One group per name per creator, case-insensitive (so "Blog" and "blog" don't
-- both get auto-created). The get-or-create + rename paths rely on this.
create unique index if not exists passport_groups_user_name_uidx
  on public.passport_groups (user_id, lower(name));
create index if not exists passport_groups_user_idx
  on public.passport_groups (user_id, created_at desc);

-- Each link optionally belongs to a group. ON DELETE SET NULL so deleting a
-- group just un-groups its links (never deletes the links or their click history).
alter table public.passport_links
  add column if not exists group_id uuid references public.passport_groups(id) on delete set null;
create index if not exists passport_links_group_idx on public.passport_links (group_id);

-- RLS: a creator sees + manages only their own groups. The public redirect uses
-- the service-role client, which bypasses RLS, so grouping never blocks a click.
alter table public.passport_groups enable row level security;
drop policy if exists passport_groups_own on public.passport_groups;
create policy passport_groups_own on public.passport_groups
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ── Backfill: group the links that already exist ──────────────────────────────
-- Mirror lib/passport-links.ts channelForSource() in SQL so existing links get
-- the same channel group new ones will. Two steps: create the needed groups,
-- then point each link at its group. Idempotent (safe to re-run).
insert into public.passport_groups (user_id, name)
select distinct user_id,
  case
    when source is null or source = '' then 'General'
    when lower(source) = 'blog' then 'Blog'
    when lower(source) = 'pinterest' then 'Pinterest'
    when lower(source) in ('social','facebook','twitter','x','threads','linkedin','telegram','bluesky','instagram') then 'Social'
    when lower(source) = 'epc' then 'EPC'
    when lower(source) = 'scout' then 'SCOUT'
    when lower(source) in ('video','youtube') or source ~ '^[A-Za-z0-9_-]{11}$' then 'YouTube'
    else 'General'
  end
from public.passport_links
on conflict (user_id, lower(name)) do nothing;

update public.passport_links pl
set group_id = pg.id
from public.passport_groups pg
where pg.user_id = pl.user_id
  and pl.group_id is null
  and pg.name = (
    case
      when pl.source is null or pl.source = '' then 'General'
      when lower(pl.source) = 'blog' then 'Blog'
      when lower(pl.source) = 'pinterest' then 'Pinterest'
      when lower(pl.source) in ('social','facebook','twitter','x','threads','linkedin','telegram','bluesky','instagram') then 'Social'
      when lower(pl.source) = 'epc' then 'EPC'
      when lower(pl.source) = 'scout' then 'SCOUT'
      when lower(pl.source) in ('video','youtube') or pl.source ~ '^[A-Za-z0-9_-]{11}$' then 'YouTube'
      else 'General'
    end
  );

notify pgrst, 'reload schema';
