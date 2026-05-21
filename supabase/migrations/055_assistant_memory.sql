-- 055 — Lightweight per-user memory for the AI assistant
--
-- A single rolling "what I know about this user" note per user, injected
-- into every assistant conversation so the chat feels continuous across
-- threads (preferences, goals, recurring topics, decisions). Auto-updated
-- after chat turns, and seedable by importing a user's exported history
-- from ChatGPT / other tools (distilled into this note).

create table if not exists public.assistant_memory (
  user_id     uuid primary key references auth.users(id) on delete cascade,
  memory      text not null default '',
  updated_at  timestamptz not null default now()
);

alter table public.assistant_memory enable row level security;

drop policy if exists "own assistant memory select" on public.assistant_memory;
create policy "own assistant memory select" on public.assistant_memory for select using (auth.uid() = user_id);
drop policy if exists "own assistant memory insert" on public.assistant_memory;
create policy "own assistant memory insert" on public.assistant_memory for insert with check (auth.uid() = user_id);
drop policy if exists "own assistant memory update" on public.assistant_memory;
create policy "own assistant memory update" on public.assistant_memory for update using (auth.uid() = user_id);
