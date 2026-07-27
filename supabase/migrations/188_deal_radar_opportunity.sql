-- 188 — Deal Radar "opportunity score": one money-oriented ranking.
--
-- Single-axis sorts (discount / commission / best-seller) each miss something.
-- This blends the signals a creator actually earns on into one score so the
-- best deals to PROMOTE rise to the top:
--   • discount depth        — bigger drop = more compelling
--   • real-deal verdict      — a verified genuine discount beats a fake markdown
--   • sales volume           — proven demand (Amazon "bought/mo"), capped
--   • popularity             — review count as a dense demand proxy (log-scaled)
--   • Creator Connections    — an elevated bounty is direct extra money
--
-- STORED generated column so it's computed on write (the cron's upserts) and
-- indexable for an ORDER BY. All functions are immutable (required for STORED).
ALTER TABLE deal_radar_cache
  ADD COLUMN IF NOT EXISTS opportunity_score numeric GENERATED ALWAYS AS (
    coalesce(least(discount_pct, 60), 0) * 0.6
    + case deal_quality when 'excellent' then 25 when 'genuine' then 15 when 'fair' then 5 else 0 end
    + case when monthly_sold is not null then least(monthly_sold / 100.0, 20) else 0 end
    + case when review_count is not null then least(ln(review_count + 1) * 2, 12) else 0 end
    + coalesce(campaign_commission_pct, 0) * 1.5
  ) STORED;

CREATE INDEX IF NOT EXISTS deal_radar_opportunity_idx
  ON deal_radar_cache (opportunity_score DESC);
