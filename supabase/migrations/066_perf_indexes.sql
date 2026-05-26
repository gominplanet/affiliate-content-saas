-- 066_perf_indexes.sql
-- Performance P1 (#19): user_id-leading composite indexes for the hottest
-- per-user query paths. All `if not exists` + plain (non-concurrent) so this is
-- safe to run in one paste in the Supabase SQL editor. Tables are small at this
-- stage, so the build is instant; the payoff grows with row count.

-- blog_posts: the content listing + voice-anchor + internal-link queries all
-- filter by user_id (+ status) and order by published_at. Today only a
-- geniuslink_code index exists, so these do a user_id seq-scan + sort.
create index if not exists blog_posts_user_status_published_idx
  on public.blog_posts (user_id, status, published_at desc);

-- blog_posts: the per-video lookup (.eq user_id .eq video_id) used on every
-- generate / re-generate to find the existing post.
create index if not exists blog_posts_user_video_idx
  on public.blog_posts (user_id, video_id);

-- ai_usage: checkUsageCap runs on EVERY generation pre-flight —
-- .eq(user_id).in(feature).gte(created_at). The existing indexes lead with
-- created_at / tier / feature, none with user_id, so the cap check scans all of
-- a user's rows. This composite makes it an index range scan.
create index if not exists ai_usage_user_feature_created_idx
  on public.ai_usage (user_id, feature, created_at desc);
