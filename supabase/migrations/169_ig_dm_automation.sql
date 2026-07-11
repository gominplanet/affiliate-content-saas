-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 169 — Instagram comment→DM automation (ManyChat-style), Phase 1.
--
-- When a viewer comments a keyword (e.g. "LINK") on one of the creator's IG
-- posts, MVP auto-DMs them that post's affiliate link via Meta Private Replies.
-- Phase 1 is the review-INDEPENDENT groundwork: global per-user settings + a
-- dedupe/audit log. The webhook + send path go live only once Meta approves the
-- messaging/comment permissions (Phase 2) — see project_ig_comment_to_dm memory.
--
-- Link is resolved PER POST at reply time (geni.us code → affiliate link in the
-- post body → blog URL), so each IG post DMs its OWN link. No new column needed
-- there — blog_posts already stores instagram_*_id (media) + geniuslink_code.
-- ─────────────────────────────────────────────────────────────────────────────

-- One row per user: the global comment→DM automation config. Opt-in (enabled
-- defaults false) to respect Meta's consent posture + the AI/send cost.
create table if not exists public.ig_dm_settings (
  user_id          uuid primary key references auth.users(id) on delete cascade,
  enabled          boolean not null default false,
  keyword          text    not null default 'LINK',
  -- {link} is substituted with the post's resolved affiliate link at send time.
  message_template text    not null default E'Here you go 🔗 {link}\n\nReply STOP to opt out.',
  -- Also post a public "Sent you a DM! 📩" reply on the comment (what ManyChat does).
  reply_to_comment boolean not null default true,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

alter table public.ig_dm_settings enable row level security;
drop policy if exists "own ig_dm_settings" on public.ig_dm_settings;
create policy "own ig_dm_settings" on public.ig_dm_settings
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Dedupe + audit log. `comment_id` UNIQUE enforces Meta's "one private reply per
-- comment, ever" — the webhook inserts here BEFORE sending, so a redelivered
-- webhook conflicts and is skipped instead of double-DMing.
create table if not exists public.ig_dm_sends (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null,
  comment_id   text not null unique,
  media_id     text,
  commenter_id text,
  keyword      text,
  link_sent    text,
  status       text not null default 'sent',   -- sent | failed | skipped
  error        text,
  created_at   timestamptz not null default now()
);
create index if not exists ig_dm_sends_user_idx on public.ig_dm_sends(user_id, created_at desc);

alter table public.ig_dm_sends enable row level security;
-- Users can read their own send log; writes are service-role only (the webhook).
drop policy if exists "own ig_dm_sends read" on public.ig_dm_sends;
create policy "own ig_dm_sends read" on public.ig_dm_sends
  for select using (auth.uid() = user_id);
