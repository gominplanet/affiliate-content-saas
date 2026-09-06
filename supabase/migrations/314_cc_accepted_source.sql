-- 314 — Remember WHICH part of MVP joined each campaign.
--
-- cc_accepted_campaigns is the record of every campaign MVP accepted, and it is
-- what the Joined Campaigns page reads to answer "show me the campaigns I joined
-- through MVP, so I can make something for them". Two things were missing.
--
-- It never recorded WHERE the accept came from, so a creator looking at the list
-- could not tell a campaign they joined deliberately from one a bulk message
-- joined on their behalf, which for a long time it did without asking.
--
-- And it only ever recorded campaigns Amazon gave an id for. The write was
-- guarded on that id, so every accept without one vanished from the record while
-- succeeding on Amazon. The route now falls back to a stable per-product id, so
-- there is always a row; this column says who put it there.
alter table public.cc_accepted_campaigns
  add column if not exists source text;

notify pgrst, 'reload schema';
