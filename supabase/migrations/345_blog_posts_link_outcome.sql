-- 345 — blog_posts.link_style_used + link_fallback_note:
-- which link the post actually shipped, not which one the setting asked for.
--
-- A creator picks one link style (Passport, Geniuslink, Bitly, Direct) and every
-- generator applies it. When it cannot be applied the post still publishes, with
-- a plain tagged Amazon link, which is the right call: a post that earns is
-- better than no post. What was missing is that nothing recorded the swap.
--
-- app/api/blog/generate has computed a linkFallbackNote for a while and returned
-- it in the HTTP response, where GenerateButton showed it as a toast. Scheduled
-- and queued generation has no browser, and schedule-publish reads four keys out
-- of that response and discards the rest, so a downgrade on an unattended post
-- was recorded in no place a human would ever look.
--
-- That is how a credential bug ran unnoticed: the Geniuslink API key and secret
-- are encrypted at rest, twelve generators passed the raw integrations row to
-- geniuslinkCreds, and the raw row won over the decrypted one. Geniuslink was
-- called with a base64 envelope as a key, answered 401, and every route fell
-- back to a plain tagged link. Affected creators saw their chosen style stop
-- being used on every surface at once while the settings screen kept reporting
-- it correctly, because the setting was never what broke.
--
-- link_style_used is read off the published URL rather than the setting, so the
-- two can be compared. A row where it disagrees with the creator's chosen style
-- is a post that needs re-pointing, and Fix Affiliate Links is what re-points it.
--
-- Safe to run more than once.

alter table public.blog_posts
  add column if not exists link_style_used text;

alter table public.blog_posts
  add column if not exists link_fallback_note text;

comment on column public.blog_posts.link_style_used is
  'The link style READ OFF the published affiliate URL: passport | geniuslink | bitly | direct. What the post actually shipped, which is the only thing a post can report honestly. Compare against the creator''s chosen style to find posts that need re-pointing. Null on posts written before this column, and on posts with no affiliate link.';

comment on column public.blog_posts.link_fallback_note is
  'Set when the post published with a plain link because the chosen style could not be used: a Geniuslink 401, a Passport mint failure, credentials missing. The sentence shown to the creator. Null means no downgrade happened, never "not checked".';

-- Finding the downgraded posts is the whole point, and they are a small
-- minority, so both indexes are partial.
create index if not exists blog_posts_link_style_used_idx
  on public.blog_posts (user_id, link_style_used)
  where link_style_used is not null;

create index if not exists blog_posts_link_fallback_idx
  on public.blog_posts (user_id, created_at desc)
  where link_fallback_note is not null;
