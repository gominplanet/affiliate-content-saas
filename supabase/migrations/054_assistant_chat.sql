-- 054 — In-dashboard AI assistant (product help + affiliate coach)
--
-- A chat surface where users talk to a Claude-backed assistant that knows
-- MVP Affiliate's features AND their brand profile. Conversations persist
-- so users can pick threads back up. Per-tier monthly message caps live in
-- lib/tier.ts and are enforced off ai_usage telemetry (feature
-- 'assistant_message'), so no counter table is needed here.

create table if not exists public.assistant_conversations (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  title       text not null default 'New chat',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table if not exists public.assistant_messages (
  id               uuid primary key default gen_random_uuid(),
  conversation_id  uuid not null references public.assistant_conversations(id) on delete cascade,
  user_id          uuid not null references auth.users(id) on delete cascade,
  role             text not null check (role in ('user', 'assistant')),
  content          text not null,
  created_at       timestamptz not null default now()
);

create index if not exists assistant_conv_user_idx
  on public.assistant_conversations (user_id, updated_at desc);
create index if not exists assistant_msg_conv_idx
  on public.assistant_messages (conversation_id, created_at);

alter table public.assistant_conversations enable row level security;
alter table public.assistant_messages enable row level security;

-- Conversations: owner-only CRUD.
drop policy if exists "own assistant conversations select" on public.assistant_conversations;
create policy "own assistant conversations select" on public.assistant_conversations for select using (auth.uid() = user_id);
drop policy if exists "own assistant conversations insert" on public.assistant_conversations;
create policy "own assistant conversations insert" on public.assistant_conversations for insert with check (auth.uid() = user_id);
drop policy if exists "own assistant conversations update" on public.assistant_conversations;
create policy "own assistant conversations update" on public.assistant_conversations for update using (auth.uid() = user_id);
drop policy if exists "own assistant conversations delete" on public.assistant_conversations;
create policy "own assistant conversations delete" on public.assistant_conversations for delete using (auth.uid() = user_id);

-- Messages: owner-only read/insert (server writes assistant replies via
-- the service-role client, which bypasses RLS).
drop policy if exists "own assistant messages select" on public.assistant_messages;
create policy "own assistant messages select" on public.assistant_messages for select using (auth.uid() = user_id);
drop policy if exists "own assistant messages insert" on public.assistant_messages;
create policy "own assistant messages insert" on public.assistant_messages for insert with check (auth.uid() = user_id);
