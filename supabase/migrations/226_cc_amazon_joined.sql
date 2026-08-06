-- 226 — Persisted "joined on Amazon" marker for Creator Connections campaigns.
--
-- WHY: "Joined only" should mirror the campaigns the creator has actually joined
-- on Amazon, and it should PERSIST — so a user opens CC Campaigns and sees their
-- joined list from MVP's own DB, without re-running the SCOUT sync every visit.
--
-- Until now "joined" was inferred from campaigns.accepted_at, which is also set by
-- other flows and accumulated stale rows (opportunities wrongly written by an
-- early sync). This adds a dedicated, authoritative column that ONLY the joined
-- sync and in-app accept set, so the joined view is both durable and clean.
--
--   campaigns.amazon_joined_at — set when SCOUT confirms the campaign is in the
--     creator's ACTIVE/joined list on Amazon (or when they accept in-app). A full
--     sync reconciles it: campaigns no longer in Amazon's list get it cleared.
--
-- Back-compat: accepted_at is still written alongside it, so existing badges and
-- Hide-joined logic keep working. Nothing reads amazon_joined_at until the app is
-- deployed, so this is safe to apply any time.

ALTER TABLE public.campaigns
  ADD COLUMN IF NOT EXISTS amazon_joined_at timestamptz;

-- Fast lookup of a user's joined set (the "Joined only" filter + reconcile).
CREATE INDEX IF NOT EXISTS campaigns_user_amazon_joined_idx
  ON public.campaigns (user_id, amazon_joined_at)
  WHERE amazon_joined_at IS NOT NULL;

COMMENT ON COLUMN public.campaigns.amazon_joined_at IS
  'When set, this campaign is confirmed joined on Amazon (SCOUT active-view sync or in-app accept). Authoritative source for the "Joined only" filter; a full sync clears it for campaigns no longer in Amazon''s joined list.';
