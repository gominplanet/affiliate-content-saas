// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// Labs features still being tested by the owner, before any Pro user sees them.
//
// ONE SWITCH PER FEATURE, IN ONE PLACE. Each new tool is shown only to admin
// until it has been tried on the live site. Opening one to Pro is a one-word
// change here, and the nav, the pages and the routes all follow it.

import { normalizeTier } from '@/lib/tier'
import { canSeeNav } from '@/lib/feature-access'

export type PreviewFeature = 'on_sale' | 'amazon_live' | 'comparison' | 'shorts_mode' | 'first_comment' | 'brand_recap' | 'deal_aftercare' | 'post_refresh' | 'facebook_reels' | 'whole_video' | 'sold_campaigns' | 'liftoff_split' | 'earnings' | 'live_followup'

/** Who may use each preview feature: 'admin' while testing, 'labs' once open to Pro. */
const OPEN_TO: Record<PreviewFeature, 'admin' | 'labs'> = {
  // Encore: open to Pro, and in the Create menu since it left Labs.
  on_sale: 'labs',
  // Amazon Live prep: graduated out of Labs to Pro 2026-09, in Amazon Influencer.
  amazon_live: 'labs',
  // Co-Pilot comparison videos: 2 to 4 products in one video. Open to Pro.
  comparison: 'labs',
  // Co-Pilot Short mode: Shorts get Short-shaped metadata (links in Shorts are not clickable).
  shorts_mode: 'labs',
  // Pinned comments (Co-Pilot, Liftoff, older videos): graduated out of Labs
  // to Pro 2026-09. The page is Create > Pinned Comments.
  first_comment: 'labs',
  // Brand recap: one message per Creator Connections brand with every link made
  // for it. Graduated out of Labs to Pro 2026-09, in Collaborate.
  brand_recap: 'labs',
  // Ended deals: deal posts whose sale is over, turned into lasting reviews in
  // place. Graduated out of Labs to Pro 2026-09, in Create beside Deals Hub.
  deal_aftercare: 'labs',
  // Post updates: after 90 days, the creator adds one first-hand line to a review.
  post_refresh: 'labs',
  // Clip Factory clips published as Reels on the creator's Facebook Page.
  facebook_reels: 'labs',
  // Clip Factory: post the whole video (up to 10 minutes) as one vertical clip.
  whole_video: 'labs',
  // Earnings: accept Creator Connections campaigns for products already selling.
  // Back to admin 2026-10-01 with the Earnings page it lives on: its daily
  // switch is on that page, and its product rows come from that sync.
  sold_campaigns: 'admin',
  // Liftoff in two parts: YouTube first (no countries), then Amazon when
  // YouTube is done, started with its own button.
  // All six above opened to Pro 2026-09-30 (Seb: "pro should get it all").
  liftoff_split: 'labs',
  // Amazon Earnings page: back in Labs, admin only, 2026-10-01 (Seb: "put it
  // into labs for now"). The product sync reads 0 rows.
  earnings: 'admin',
  // Amazon Live follow-up: clips and a roundup post from a Live replay.
  // Admin only while it is tested (Seb, 2026-10-01: "behind labs").
  live_followup: 'admin',
}

export function canUsePreview(feature: PreviewFeature, rawTier: unknown): boolean {
  const tier = normalizeTier(rawTier)
  return OPEN_TO[feature] === 'admin' ? tier === 'admin' : canSeeNav('labs', tier)
}

export function previewOpenToPro(feature: PreviewFeature): boolean {
  return OPEN_TO[feature] === 'labs'
}
