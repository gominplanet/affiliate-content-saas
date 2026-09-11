-- 328 — which onboarding an account is on.
--
-- There is one funnel and its first step is "Connect YouTube", required, with
-- every later step locked until it is done. An Amazon influencer has no channel
-- and never will, so that screen is where they stop, having clicked an ad about
-- turning a product link into a design.
--
-- The choice they make (from the ad, or from the fork on the funnel itself)
-- rides in the URL so it survives the round trip through their email
-- confirmation, and is written here the first time the onboarding renders. Null
-- means nobody has stated one, which stays distinguishable from 'creator': the
-- app then guesses from what is connected, and never writes a guess down.
--
-- Safe to run more than once.

alter table public.integrations
  add column if not exists onboarding_path text;

comment on column public.integrations.onboarding_path is
  'Which onboarding this account is on: amazon | creator. Null = never stated; the app guesses from connections and does not persist a guess.';

-- Existing accounts that are clearly Amazon-shaped: an Associates tag, no
-- YouTube, no WordPress. These are people who signed up before there was a
-- second door, so leaving them unmarked sends them back through the funnel that
-- has nothing for them. Only rows with no path already set are touched, so a
-- re-run cannot overwrite a later, explicit choice.
update public.integrations
   set onboarding_path = 'amazon'
 where onboarding_path is null
   and coalesce(nullif(trim(amazon_associates_tag), ''), null) is not null
   and coalesce(nullif(trim(wordpress_url), ''), null) is null
   and youtube_oauth_access_token is null
   and youtube_channel_id is null;
