-- 049 — Per-user 👍 / 👎 feedback on generated thumbnails
--
-- Every time the user reacts to a generated thumbnail (YT Co-Pilot or
-- the new IG AI image), we drop a row here. The Studio page reads
-- aggregated feedback to weight the random style picker — styles the
-- user consistently rejects get excluded from the pool; styles they
-- like get boosted.
--
-- Future work: a Haiku pass over the dislikes could surface niche-
-- specific preferences ("rejects impact-classic on beauty videos") and
-- inject them into the scene prompt. v1 just does style weighting.

create table if not exists public.thumbnail_feedback (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users(id) on delete cascade,
  /** Which video this feedback was given against. Nullable because the
   *  feedback might be on an IG-modal AI image that's keyed by post_id
   *  not by youtube_video_id; we resolve it best-effort. */
  video_id        uuid references public.youtube_videos(id) on delete set null,
  /** The image URL the user reacted to — handy for debugging and for
   *  future "show me the ones I liked" UIs. */
  thumbnail_url   text not null,
  /** 'like' or 'dislike'. Constrained so we don't drift on casing. */
  reaction        text not null check (reaction in ('like', 'dislike')),
  /** Which OVERLAY_STYLES preset was used (impact-classic, mrbeast-yellow,
   *  etc.). NULL when the user uploaded their own thumbnail and no
   *  style was applied. */
  style_id        text,
  /** Where the image came from: 'youtube' = YT Co-Pilot, 'instagram' = IG
   *  modal AI. Helps target style preferences to the surface that needs
   *  them. */
  surface         text not null check (surface in ('youtube', 'instagram')),
  /** Which Fal model produced the image. Useful for the niche-pattern
   *  follow-up work. */
  model_used      text,
  /** Brand niche at the time of feedback — copy not FK so future
   *  re-niche-ing doesn't retroactively alter feedback semantics. */
  niche           text,
  created_at      timestamptz not null default now()
);

create index if not exists thumb_feedback_user_idx on public.thumbnail_feedback (user_id, created_at desc);
create index if not exists thumb_feedback_user_style_idx on public.thumbnail_feedback (user_id, style_id, reaction);

alter table public.thumbnail_feedback enable row level security;

create policy "Users can read their own thumbnail feedback"
  on public.thumbnail_feedback for select
  using (auth.uid() = user_id);

create policy "Users can insert their own thumbnail feedback"
  on public.thumbnail_feedback for insert
  with check (auth.uid() = user_id);
