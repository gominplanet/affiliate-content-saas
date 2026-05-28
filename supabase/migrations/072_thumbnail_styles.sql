-- 072 — Saved thumbnail style presets
--
-- Each creator can pin a small library of "style reference" images they like
-- — the same kind of image the studio already accepts as a one-off styleReferenceUrl
-- when generating a thumbnail. The route extracts a visual brief from the
-- image (colors, fonts, mood, composition) and injects it into the prompt.
-- Saving them as named presets lets a creator re-apply the same look across
-- a series of thumbnails so a whole channel reads consistently.
--
-- Closes one of the thumbnailcreator.com competitor-parity gaps.

create table if not exists public.thumbnail_styles (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null,
  name          text not null,
  reference_url text not null,
  created_at    timestamptz default now()
);

create index if not exists thumbnail_styles_user_idx on public.thumbnail_styles(user_id);

alter table public.thumbnail_styles enable row level security;
drop policy if exists "thumbnail_styles_own" on public.thumbnail_styles;
create policy "thumbnail_styles_own" on public.thumbnail_styles
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
