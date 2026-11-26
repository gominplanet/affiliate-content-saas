-- Music beds (lib/music-bed, app/api/music-bed): a track made by Stable Audio 3
-- from the moods, tempo and styles a creator ticked, kept in MVP's storage,
-- checked for voices, then accepted or rejected. The server reads and writes
-- it with the service role; nobody reads it directly. Safe to run twice.
create table if not exists public.music_beds (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  model text not null,
  moods text[] not null default '{}',
  tempo text,
  styles text[] not null default '{}',
  seconds integer not null,
  prompt text not null,
  seed bigint,
  storage_path text,
  url text,
  voice_check text not null default 'unchecked',
  heard text[] not null default '{}',
  status text not null default 'preview',
  error text,
  created_at timestamptz not null default now(),
  accepted_at timestamptz
);
create index if not exists music_beds_user_idx on public.music_beds (user_id, created_at desc);
alter table public.music_beds enable row level security;
notify pgrst, 'reload schema';
