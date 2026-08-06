-- 227 — Daily CC Campaign Digest: per-user cache + "already shown" ledger.
--
-- Every 24h the dashboard shows a card of ~25 Creator Connections campaigns
-- picked FOR this creator from cc_campaign_catalog, matched to their historical
-- blog + YouTube topics. Two tables:
--
--   cc_digest_cache — the generated batch for a given day, so the card renders
--     instantly on repeat visits and we only spend compute once per 24h per
--     ACTIVE user (lazy-generated on first dashboard visit; no cron needed).
--
--   cc_digest_seen — every campaign we've EVER shown this user, so no campaign
--     is ever served twice. It also stores the per-card thumbs (up/down), which
--     is the realignment signal: future digests down-weight brands/categories
--     the user thumbs-down and up-weight the ones they thumbs-up.
--
-- Both are per-user with own-row RLS (mirrors 198_cc_message_links).

CREATE TABLE IF NOT EXISTS cc_digest_cache (
  user_id      uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  digest_date  date NOT NULL,                       -- the day key (UTC)
  campaigns    jsonb NOT NULL DEFAULT '[]'::jsonb,  -- the ranked cards for the day
  generated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, digest_date)
);

ALTER TABLE cc_digest_cache ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "own cc_digest_cache" ON cc_digest_cache;
CREATE POLICY "own cc_digest_cache" ON cc_digest_cache
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE TABLE IF NOT EXISTS cc_digest_seen (
  user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  campaign_id text NOT NULL,
  shown_on    date NOT NULL DEFAULT (now() AT TIME ZONE 'utc')::date,
  -- Realignment signal, set when the user reacts to the card:
  --   'up'   → they liked this campaign (up-weight its brand + category)
  --   'down' → they disliked it (down-weight)
  --   null   → shown, no reaction yet
  feedback    text CHECK (feedback IN ('up', 'down')),
  brand_name  text,   -- denormalized so realignment can aggregate without a join
  category    text,   -- the niche/keyword this campaign matched on
  reacted_at  timestamptz,
  PRIMARY KEY (user_id, campaign_id)
);

ALTER TABLE cc_digest_seen ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "own cc_digest_seen" ON cc_digest_seen;
CREATE POLICY "own cc_digest_seen" ON cc_digest_seen
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- Fast "what has this user reacted to" lookups for realignment.
CREATE INDEX IF NOT EXISTS cc_digest_seen_feedback_idx
  ON cc_digest_seen (user_id, feedback) WHERE feedback IS NOT NULL;

NOTIFY pgrst, 'reload schema';
