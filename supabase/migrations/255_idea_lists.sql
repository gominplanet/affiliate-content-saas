-- © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
--
-- Idea Lists sync (SCOUT). Stores each creator's Amazon influencer idea lists
-- captured by the SCOUT extension from their storefront, so the dashboard can
-- show them without a pasted URL, and generate a shopping-guide from the full
-- product set (SCOUT captures every item, beating the ~20 a server fetch gets).
--
-- items is a JSONB array of { asin, title, image } — a list can hold hundreds,
-- and we only ever read the whole set at generate time, so one JSONB column
-- beats a child table here.

create table if not exists public.idea_lists (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references auth.users(id) on delete cascade,
  amazon_list_id   text not null,                 -- the list id in the Amazon URL (/list/<id>)
  title            text,
  url              text,
  item_count       integer,                        -- Amazon's declared count
  cover_image      text,
  items            jsonb not null default '[]'::jsonb,
  items_synced_at  timestamptz,                    -- when the full product set was last captured
  updated_at       timestamptz not null default now(),
  created_at       timestamptz not null default now(),
  unique (user_id, amazon_list_id)
);

create index if not exists idea_lists_user_idx on public.idea_lists (user_id, updated_at desc);

alter table public.idea_lists enable row level security;

-- Owner can read their own lists (the dashboard runs as the signed-in user).
drop policy if exists idea_lists_select_own on public.idea_lists;
create policy idea_lists_select_own on public.idea_lists
  for select using (auth.uid() = user_id);

-- Writes go through the service-role ingest endpoint (SCOUT → session-authed
-- API → admin client), so no INSERT/UPDATE policy for the anon/auth role.
