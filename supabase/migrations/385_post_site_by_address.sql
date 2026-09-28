-- 385: every post filed under the site its own address is on.
--
-- Posts written before multi-site, and some written by other paths since,
-- carry no wordpress_site_id. Every edit that follows (title fixes, SEO fixes,
-- link fixes, publish now, updates) then resolves "no site" to the DEFAULT
-- site and writes to that site's post with the same number, which on a
-- creator with several blogs is a different post. That is how a Beard Club
-- trimmer review on one blog came to carry a Beatbot pool robot title.
--
-- 1. url_host(): the host of a URL, lowercase, without www.
-- 2. Backfill: each post gets the site whose address matches its own URL,
--    where one does. Posts whose URL matches no connected site are left alone.
-- 3. A trigger keeps it that way for new posts and changed URLs.
--
-- Safe to run more than once.

create or replace function public.url_host(u text) returns text
language sql immutable as $$
  select nullif(lower(regexp_replace(split_part(split_part(split_part(coalesce(u, ''), '://', 2), '/', 1), '?', 1), '^www\.', '')), '')
$$;

update public.blog_posts bp
set wordpress_site_id = ws.id
from public.wordpress_sites ws
where ws.user_id = bp.user_id
  and bp.wordpress_url is not null
  and public.url_host(ws.url) = public.url_host(bp.wordpress_url)
  and bp.wordpress_site_id is distinct from ws.id;

create or replace function public.blog_posts_site_from_url() returns trigger
language plpgsql as $$
declare
  match uuid;
begin
  if new.wordpress_url is null then return new; end if;
  if tg_op = 'UPDATE' and new.wordpress_url is not distinct from old.wordpress_url
     and new.wordpress_site_id is not distinct from old.wordpress_site_id then
    return new;
  end if;
  select ws.id into match from public.wordpress_sites ws
   where ws.user_id = new.user_id and public.url_host(ws.url) = public.url_host(new.wordpress_url)
   limit 1;
  -- Only ever set to a site that matches; never cleared for lack of one.
  if match is not null then new.wordpress_site_id := match; end if;
  return new;
end $$;

drop trigger if exists blog_posts_site_from_url on public.blog_posts;
create trigger blog_posts_site_from_url
  before insert or update of wordpress_url, wordpress_site_id on public.blog_posts
  for each row execute function public.blog_posts_site_from_url();

notify pgrst, 'reload schema';
