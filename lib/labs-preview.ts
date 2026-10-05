// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// Labs features still being tested by the owner, before any Pro user sees them.
//
// ONE SWITCH PER FEATURE, IN ONE PLACE. Each new tool is shown only to admin
// until it has been tried on the live site. Opening one to Pro is a one-word
// change here, and the nav, the pages and the routes all follow it.

import { normalizeTier } from '@/lib/tier'
import { canSeeNav } from '@/lib/feature-access'

export type PreviewFeature = 'on_sale' | 'amazon_live' | 'comparison' | 'shorts_mode' | 'first_comment' | 'brand_recap' | 'deal_aftercare' | 'post_refresh' | 'facebook_reels' | 'whole_video' | 'sold_campaigns' | 'liftoff_split' | 'earnings' | 'live_followup' | 'video_plan' | 'studio_upload' | 'facebook_setup'

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
  // Opened to Pro 2026-10-01 (Seb: "open up to Pro"). Drafts only.
  live_followup: 'labs',
  // Plan this video: a joined Creator Connections campaign turned into a video
  // plan. Admin only while it is tested (Seb, 2026-10-01: "behind labs first").
  video_plan: 'admin',
  // Liftoff uploads through SCOUT in YouTube Studio instead of YouTube's API,
  // so an upload costs nothing from the shared daily quota. Admin only while
  // it is tested (Seb, 2026-10-02: "we need to rely on scout"). Opened to Pro
  // 2026-10-05 after one back catalogue of API comments used the whole day's
  // shared quota by 2 pm (Seb: "get scout running and helping out for all
  // users right away"). Pro members already run SCOUT for the Amazon side.
  studio_upload: 'labs',
  // Meta Hub (Page, niche Groups, SCOUT, Reels, reviews) and the Group-first
  // Facebook post in Social Push, one switch for both. Open to Pro first (Seb,
  // 2026-10-05: "pro first"); the Amazon plan keeps the direct Page post.
  facebook_setup: 'labs',
}

/** Pro features the AMAZON plan has too (Seb, 2026-10-05: "add all six",
 *  for current and new Amazon members): pinned comments, On sale comments,
 *  Amazon Live and its follow-up, uploads through SCOUT in Studio, and Clip
 *  Factory's Reels to Facebook. Only features already open to Pro; one still
 *  'admin' stays admin. The Amazon plan's own allowances are in lib/amazon-plan. */
const ALSO_AMAZON: ReadonlySet<PreviewFeature> = new Set<PreviewFeature>([
  'first_comment', 'on_sale', 'amazon_live', 'live_followup', 'studio_upload',
  'facebook_reels', 'whole_video', 'liftoff_split', 'comparison', 'shorts_mode',
])

export function canUsePreview(feature: PreviewFeature, rawTier: unknown): boolean {
  const tier = normalizeTier(rawTier)
  if (OPEN_TO[feature] === 'admin') return tier === 'admin'
  return canSeeNav('labs', tier) || (tier === 'amazon' && ALSO_AMAZON.has(feature))
}

/** Is this feature open to the Amazon plan as well as Pro. */
export function previewOpenToAmazon(feature: PreviewFeature): boolean {
  return OPEN_TO[feature] === 'labs' && ALSO_AMAZON.has(feature)
}

export function previewOpenToPro(feature: PreviewFeature): boolean {
  return OPEN_TO[feature] === 'labs'
}
