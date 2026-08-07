-- Persist the social platforms a creator ticked when scheduling a blog post.
--
-- Until now the chosen socials only existed as scheduled_posts child rows, and
-- those rows are ONLY created for platforms the creator has connected. So a post
-- scheduled with "also post to Facebook + Pinterest" showed nothing on the
-- Scheduled card if those channels weren't connected yet — the selection was
-- lost. Store the raw ticked platforms here so the card can always show
-- "Then posts to: Facebook, Pinterest" regardless of connection state.
--
-- Nullable text[]; null/empty means no socials were scheduled with the post.
alter table public.blog_posts
  add column if not exists scheduled_social_platforms text[] null;

comment on column public.blog_posts.scheduled_social_platforms is
  'Social platforms the creator selected to cascade after this scheduled blog post goes live (as ticked at schedule time, before connection filtering). Drives the "Then posts to:" summary on the Scheduled card.';
