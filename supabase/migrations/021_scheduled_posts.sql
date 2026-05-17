-- Migration 021: Scheduled social posts
--
-- Until now every social publish was synchronous: click pill -> AI gen
-- -> publish. This adds a deferred path: user picks a date/time in the
-- preview modal, we save the post body + target platform here, and a
-- Vercel cron polls every minute and publishes due rows.
--
-- Design notes:
--   - One row per (post, platform) — a user can schedule the same blog
--     post to different platforms at different times.
--   - `body_text` is REQUIRED (not nullable). The preview-modal flow
--     always generates + shows the text before scheduling, so we lock
--     in the content at schedule time. No "generate fresh at publish"
--     ambiguity. User wants fresh text later → re-schedule.
--   - `status` lifecycle: pending -> processing -> completed | failed
--     | cancelled. `processing` is a claim guard for the cron worker
--     so two concurrent cron invocations can't double-post.
--   - `external_id` stores the platform's post id once publish succeeds
--     (mirrors how the manual flow stores e.g. twitter_post_id on the
--     blog_posts row).

create table if not exists public.scheduled_posts (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users(id) on delete cascade,
  blog_post_id    uuid not null references public.blog_posts(id) on delete cascade,
  platform        text not null check (platform in (
                    'facebook', 'threads', 'twitter', 'linkedin', 'bluesky', 'telegram'
                  )),
  scheduled_at    timestamptz not null,
  body_text       text not null,
  status          text not null default 'pending' check (status in (
                    'pending', 'processing', 'completed', 'failed', 'cancelled'
                  )),
  attempts        int  not null default 0,
  last_attempt_at timestamptz,
  claimed_at      timestamptz,
  error_message   text,
  external_id     text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- The cron worker hits this index on every tick (every minute). Filter
-- by status + scheduled_at, ordered by scheduled_at so oldest-due go
-- first. Partial index keeps it tiny (only pending rows).
create index if not exists scheduled_posts_due_idx
  on public.scheduled_posts (scheduled_at)
  where status = 'pending';

-- For the user-facing list ("my scheduled posts") and for cancel/edit.
create index if not exists scheduled_posts_user_idx
  on public.scheduled_posts (user_id, scheduled_at desc);

-- Standard RLS: a user can only see/modify their own scheduled rows.
-- The cron worker uses the service-role key and bypasses RLS.
alter table public.scheduled_posts enable row level security;

drop policy if exists "scheduled_posts_select_own" on public.scheduled_posts;
create policy "scheduled_posts_select_own" on public.scheduled_posts
  for select using (auth.uid() = user_id);

drop policy if exists "scheduled_posts_insert_own" on public.scheduled_posts;
create policy "scheduled_posts_insert_own" on public.scheduled_posts
  for insert with check (auth.uid() = user_id);

drop policy if exists "scheduled_posts_update_own" on public.scheduled_posts;
create policy "scheduled_posts_update_own" on public.scheduled_posts
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
