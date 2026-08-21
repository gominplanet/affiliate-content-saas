-- 274 — Choose the link style for a blog link shared to social.
--
-- Every Geniuslink click costs money, and a social→blog link earns no
-- commission (it's just attribution), so paying Geniuslink for that traffic can
-- be poor value as a site grows. This lets each creator pick how their blog link
-- is shared on social:
--   'direct'      — the plain WordPress URL (free, no tracking) — the new default
--   'geniuslink'  — a branded geni.us short link (tracked, costs per click)
--   'bitly'       — a free Bitly short link (needs the creator's Bitly token)
--
-- Blog→Amazon links are untouched — those still use Geniuslink with the group
-- settings, where the commission + attribution actually matter. Idempotent.

alter table public.integrations
  add column if not exists blog_social_link_mode text not null default 'direct',
  add column if not exists bitly_access_token text;

-- Preserve behavior for anyone who had the old geni.us-wrap toggle on.
update public.integrations
  set blog_social_link_mode = 'geniuslink'
  where wrap_blog_geniuslink is true
    and blog_social_link_mode = 'direct';

alter table public.integrations
  drop constraint if exists integrations_blog_social_link_mode_chk;
alter table public.integrations
  add constraint integrations_blog_social_link_mode_chk
  check (blog_social_link_mode in ('direct', 'geniuslink', 'bitly'));

comment on column public.integrations.blog_social_link_mode is
  'How a blog link is shortened when shared to social: direct | geniuslink | bitly.';
comment on column public.integrations.bitly_access_token is
  'Bitly generic access token, used when blog_social_link_mode = bitly.';

notify pgrst, 'reload schema';
