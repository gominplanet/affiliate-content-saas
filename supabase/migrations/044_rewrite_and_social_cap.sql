-- 044 — Pro-only post rewrites + per-social republish caps
--
-- rewrite_count          — number of times this post has been re-generated
--                          (0 or 1 today; gated at 1/post on Pro).
-- last_rewrite_feedback  — the "what's missing" note the Pro user provided
--                          when they hit Rewrite. Passed back into the AI
--                          prompt to make the second pass actually different.
-- social_publish_counts  — { facebook: n, threads: n, twitter: n, ... } map
--                          tracking how many times the same post has been
--                          (re)published to each platform. Hard cap at 10/each
--                          to stop runaway "spam re-publish" cost.

alter table public.blog_posts
  add column if not exists rewrite_count integer not null default 0,
  add column if not exists last_rewrite_feedback text,
  add column if not exists social_publish_counts jsonb not null default '{}'::jsonb;
