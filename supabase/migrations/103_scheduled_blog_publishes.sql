-- Migration 103: Extend scheduled_posts to also schedule the BLOG PUBLISH itself.
--
-- Until now scheduled_posts only held social pushes that fire AFTER a blog
-- post is already live. The new "Schedule" flow on Library lets the user
-- pick when the post itself goes live, with the socials cascading from
-- there. We support two modes:
--
--   1) wp-native: WP post is created with status=future + post_date set
--      to the schedule time. WordPress's own cron flips it to publish.
--      We DON'T need a row in this table for the blog publish — WP handles
--      it. We DO write rows for each social push at scheduled_at + offset.
--
--   2) draft-flip: WP post is created with status=draft. We write a row
--      in this table with kind='blog_publish' at scheduled_at. Our cron
--      picks it up and PATCHes the WP post to status=publish, fires the
--      deferred publish-time hooks (IndexNow, YouTube backlink), then the
--      child social rows fire at their own scheduled_at.
--
-- Schema changes:
--   - `kind` column distinguishes 'social' (existing rows) from
--     'blog_publish' (new). Existing rows backfill to 'social'.
--   - `parent_id` lets a social row reference its blog_publish parent so
--     cancelling the parent cascades to all its children (FK ON DELETE
--     CASCADE — the parent row's deletion auto-removes children).
--   - `platform` becomes nullable: blog_publish rows have no platform.
--     A check constraint enforces "social rows MUST have a platform,
--     blog_publish rows MUST NOT" so the application can't drift.

-- 1. Add kind column. Default 'social' so existing rows backfill correctly.
alter table public.scheduled_posts
  add column if not exists kind text not null default 'social';

-- 2. Add parent_id for the cascade-cancel relationship. ON DELETE CASCADE
--    means deleting a parent (e.g. user hits "Cancel" on a scheduled blog
--    publish) automatically removes all its child social rows.
alter table public.scheduled_posts
  add column if not exists parent_id uuid
    references public.scheduled_posts(id) on delete cascade;

-- 3. Make platform nullable. Existing rows already have non-null platforms;
--    new blog_publish rows will leave it NULL.
alter table public.scheduled_posts
  alter column platform drop not null;

-- 4. Add the kind check (allowed values).
alter table public.scheduled_posts
  drop constraint if exists scheduled_posts_kind_check;
alter table public.scheduled_posts
  add constraint scheduled_posts_kind_check
  check (kind in ('social', 'blog_publish'));

-- 5. Enforce the kind ↔ platform invariant. Social rows MUST name a
--    platform; blog_publish rows MUST NOT (the WP REST patch knows where
--    to go from blog_post_id).
alter table public.scheduled_posts
  drop constraint if exists scheduled_posts_platform_kind;
alter table public.scheduled_posts
  add constraint scheduled_posts_platform_kind
  check (
    (kind = 'social' and platform is not null) or
    (kind = 'blog_publish' and platform is null)
  );

-- 6. Index used by the cascade-cancel query (find a parent's children).
create index if not exists scheduled_posts_parent_idx
  on public.scheduled_posts (parent_id)
  where parent_id is not null;

-- 7. Tighten the existing "due" index so the cron's claim query stays
--    fast as the table grows. The existing partial index on
--    (scheduled_at) where status='pending' already covers both kinds
--    (it doesn't filter by kind), so the cron's "all pending rows due
--    now" query stays index-driven.
