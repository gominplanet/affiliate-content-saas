-- ── 163: saved MVP Finder results ("Saved for later" shelf) ─────────────────
-- When a creator finds a good campaign/product in the MVP Finder they Save it
-- here to review later (buy-to-review shortlist). Replaces the old campaign
-- queue as the thing that lives under the Finder. Per-user, self-contained —
-- does not touch the legacy `campaigns` pipeline.

CREATE TABLE IF NOT EXISTS cc_saved_finds (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  asin           text NOT NULL,
  -- 'campaign' = Affiliate+ Creator Connections; 'onsite' = plain Amazon product.
  source         text NOT NULL DEFAULT 'campaign',
  campaign_id    text,                 -- amzn1.campaign.… when source='campaign'
  title          text,
  brand          text,
  image_url      text,
  commission_pct numeric,
  price          numeric,
  monthly_sales  integer,
  rating         numeric,
  has_video      boolean,
  marketplace    text DEFAULT 'us',
  details_url    text,                 -- CC campaign details URL (for Message brand)
  notes          text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, asin)               -- save a product once; re-save = no-op
);

CREATE INDEX IF NOT EXISTS cc_saved_finds_user_idx
  ON cc_saved_finds (user_id, created_at DESC);

ALTER TABLE cc_saved_finds ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "saved_finds_own" ON cc_saved_finds;
CREATE POLICY "saved_finds_own" ON cc_saved_finds
  FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());
