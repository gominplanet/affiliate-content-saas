-- © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
--
-- Which link style actually built this post.
--
-- A published post carried no record of how its affiliate links were made. When
-- one turned up on geni.us while the account believed Passport was on, the only
-- way to answer was to read four generator routes, check the ordering in each,
-- query the integrations row, and finally notice the post predated the setting
-- by a day. That is a long way to go for a question the post should answer
-- itself.
--
-- WHY THIS IS DERIVED IN SQL RATHER THAN STAMPED BY THE ROUTES. Nine routes
-- both insert a blog post and resolve a link style, and over a hundred write
-- blog_posts in total. Stamping the nine would answer today's question and
-- leave the same hole open for the tenth route somebody adds next month. A
-- trigger covers every writer that exists and every writer that will exist.
--
-- WHY IT READS THE CONTENT RATHER THAN THE INTENT. A route that intended
-- Passport but whose mint failed publishes a plain tagged Amazon link. Recording
-- what it meant to do would then say "passport" about a post containing no
-- Passport link, which is the exact class of invisible failure this column
-- exists to end. The finished HTML cannot lie about what is in it.

alter table if exists public.blog_posts
  add column if not exists link_style text;

comment on column public.blog_posts.link_style is
  'How this post''s affiliate links were built, derived from the published content by trg_blog_posts_link_style: passport | geniuslink | bitly | direct | null (no recognised affiliate link).';

create or replace function public.blog_post_link_style(body text)
returns text
language sql
immutable
as $$
  -- Precedence matches lib/link-style.ts pickLinkStyle: Passport wins, then the
  -- shorteners, then a plain tagged Amazon link. A post can legitimately contain
  -- more than one (a Passport CTA plus a bare Amazon mention in the body), and
  -- the affiliate style is the strongest signal present.
  select case
    when body is null then null
    when body ~* 'https?://([a-z0-9-]+\.)*mvpl\.ink/'   then 'passport'
    when body ~* 'https?://([a-z0-9-]+\.)*geni\.us/'    then 'geniuslink'
    when body ~* 'https?://([a-z0-9-]+\.)*bit\.ly/'     then 'bitly'
    when body ~* 'https?://([a-z0-9-]+\.)*amazon\.[a-z]' then 'direct'
    else null
  end
$$;

create or replace function public.set_blog_post_link_style()
returns trigger
language plpgsql
as $$
begin
  new.link_style := public.blog_post_link_style(new.content);
  return new;
end
$$;

drop trigger if exists trg_blog_posts_link_style on public.blog_posts;

-- BEFORE UPDATE OF content as well as INSERT: a post that gets regenerated or
-- has its links repaired changes style, and a stale stamp is worse than none.
create trigger trg_blog_posts_link_style
  before insert or update of content on public.blog_posts
  for each row execute function public.set_blog_post_link_style();

-- Backfill everything already published, so the column answers for the whole
-- archive and not only for posts made from today. This is the part that would
-- have settled the ForgeBody question in one query instead of a code hunt.
update public.blog_posts
   set link_style = public.blog_post_link_style(content)
 where link_style is distinct from public.blog_post_link_style(content);

create index if not exists blog_posts_link_style_idx
  on public.blog_posts (user_id, link_style);
