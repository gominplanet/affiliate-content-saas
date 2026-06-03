-- 091 — Blog-writer quality telemetry
--
-- The blog-writer audit (June 2026) produced a 9-rule hardening pass:
-- tic ban-list, H2 heading variety, ≥3 concrete numbers, lived-experience
-- negatives, FAQ uniqueness, conditional comparison, post-gen self-check,
-- opening hook, and a residual-leak sweep. After all that work we still
-- only knew if it was working by eyeballing individual posts.
--
-- This table captures the self-check pass's output per generated post so
-- /admin/blog-quality can show:
--   - Trend: average violations per post over last 30 / 90 days
--   - Pattern frequency: which tics still leak the most
--   - Numbers gap: which posts ship with fewer than 3 product specs
--   - Per-post drill-down: for a flagged post, what fired
--
-- One row per blog-generation that ran the self-check. Insert happens at
-- the end of /api/blog/generate (after the WP publish + blog_posts row
-- so we can FK back). Best-effort write — a failed insert here never
-- blocks the article from publishing.

create table if not exists public.blog_quality_checks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  -- Optional link to the blog_posts row this check was for. Nullable
  -- because the insert order in /api/blog/generate is: generate content →
  -- run self-check → publish to WP → insert blog_posts row. We record
  -- the check BEFORE blog_posts exists so a publish failure doesn't lose
  -- the telemetry. A nightly job (or the next generation on the same
  -- video) can backfill this column once the blog_posts row exists.
  blog_post_id uuid references public.blog_posts(id) on delete set null,
  -- The video this post was generated from. Always present (we know it
  -- before we ever call Claude) and useful for grouping checks per
  -- video on the dashboard.
  video_id uuid references public.youtube_videos(id) on delete cascade,
  -- Total violations Haiku flagged in the self-check pass.
  violations_found integer not null default 0,
  -- Subset of violations that actually landed via string-replace.
  -- violations_found - fixes_applied = paraphrase-miss count (Haiku
  -- returned a violation but the `original` didn't match verbatim).
  fixes_applied integer not null default 0,
  -- Product-specific concrete numbers counted in the final body.
  -- RULE 11 target is ≥3.
  numbers_detected integer not null default 0,
  -- Array of violation pattern labels that fired (e.g. ['ai-emphasis-defense',
  -- 'em-dash heading']). Used by the dashboard's "top leaking patterns" view.
  violation_patterns text[] not null default '{}',
  created_at timestamptz not null default now()
);

alter table public.blog_quality_checks enable row level security;
-- Users see their own checks. Admin sees all via the admin-client
-- read in the dashboard route.
drop policy if exists "Users see own blog quality checks" on public.blog_quality_checks;
create policy "Users see own blog quality checks" on public.blog_quality_checks
  for select using (auth.uid() = user_id);
-- Inserts come from the route running with the service-role client
-- (createAdminClient) since auth.uid() isn't set in cron / server-only
-- contexts. No insert policy needed for user-context inserts.

-- Index for the dashboard's date-range scans + per-user filter.
create index if not exists blog_quality_checks_user_created_idx
  on public.blog_quality_checks (user_id, created_at desc);

-- Pattern-frequency aggregation index (GIN on the patterns array).
-- Lets the dashboard count "how many posts had pattern X" without
-- scanning every row.
create index if not exists blog_quality_checks_patterns_gin
  on public.blog_quality_checks using gin (violation_patterns);

-- Numbers-under-threshold index for the "posts that need more specs" view.
create index if not exists blog_quality_checks_low_numbers_idx
  on public.blog_quality_checks (user_id, created_at desc)
  where numbers_detected < 3;
