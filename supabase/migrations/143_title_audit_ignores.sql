-- © 2026 Gominplanet / MVP Affiliate
--
-- Migration 143 — Title Check "ignore" list.
--
-- The Title Check tool (/tools/title-audit) flags posts whose title may name a
-- different product than the body. Some flags are judgment calls the creator is
-- happy to keep as-is. This table lets them DISMISS a flag so it doesn't pop up
-- on every future scan.
--
-- We store the title that was LIVE when they dismissed it. The scan skips a post
-- only while its current title still equals ignored_title — so if they later
-- edit the title (or rebuild the post), the flag re-surfaces and gets re-judged.
-- That keeps "ignore" from masking a genuinely-wrong title introduced later.
--
-- Keyed to the authenticated user (auth.uid()) for simple, standard RLS. For the
-- owner that's the same as their archive; a VA's dismissals are their own.

create table if not exists public.title_audit_ignores (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  post_id       uuid not null references public.blog_posts(id) on delete cascade,
  ignored_title text not null,
  created_at    timestamptz not null default now(),
  unique (user_id, post_id)
);

create index if not exists title_audit_ignores_user_idx
  on public.title_audit_ignores (user_id);

alter table public.title_audit_ignores enable row level security;

drop policy if exists title_audit_ignores_select_own on public.title_audit_ignores;
create policy title_audit_ignores_select_own on public.title_audit_ignores
  for select using (auth.uid() = user_id);

drop policy if exists title_audit_ignores_insert_own on public.title_audit_ignores;
create policy title_audit_ignores_insert_own on public.title_audit_ignores
  for insert with check (auth.uid() = user_id);

drop policy if exists title_audit_ignores_update_own on public.title_audit_ignores;
create policy title_audit_ignores_update_own on public.title_audit_ignores
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists title_audit_ignores_delete_own on public.title_audit_ignores;
create policy title_audit_ignores_delete_own on public.title_audit_ignores
  for delete using (auth.uid() = user_id);

comment on table public.title_audit_ignores is
  'Per-user dismissals for the Title Check tool. The scan skips a post while its current title still matches ignored_title; a later title edit re-surfaces it.';
