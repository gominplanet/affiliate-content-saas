-- © 2026 Gominplanet / MVP Affiliate
--
-- Migration 262 — append-only brand message log (for Brand Hub history).
--
-- Pitches (collaborations) and inbound inquiries already keep one row each, so
-- their full history survives. The ONE place that overwrites is a Creator
-- Connections message: campaigns.last_message holds only the LATEST send. This
-- log captures every send, so Brand Hub can show the full back-and-forth per
-- brand instead of just the last message. Best-effort writes — never block a
-- message that already went out.

create table if not exists public.brand_messages (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null,                 -- the creator (owner)
  brand_name text,                          -- brand the message is with
  direction  text not null default 'outbound', -- outbound | inbound
  channel    text not null default 'cc',       -- cc | pitch | inquiry
  body       text,
  created_at timestamptz not null default now()
);

create index if not exists brand_messages_user_idx
  on public.brand_messages (user_id, created_at desc);

alter table public.brand_messages enable row level security;

drop policy if exists brand_messages_select on public.brand_messages;
create policy brand_messages_select on public.brand_messages
  for select using ( user_id = auth.uid() or public.is_accepted_member_of(user_id) );

drop policy if exists brand_messages_insert on public.brand_messages;
create policy brand_messages_insert on public.brand_messages
  for insert with check ( user_id = auth.uid() or public.is_accepted_member_of(user_id) );

comment on table public.brand_messages is
  'Append-only per-brand message log powering the Brand Hub timeline (full history vs the single-column snapshots).';
