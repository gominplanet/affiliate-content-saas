// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// Labs features still being tested by the owner, before any Pro user sees them.
//
// ONE SWITCH PER FEATURE, IN ONE PLACE. Each new tool is shown only to admin
// until it has been tried on the live site. Opening one to Pro is a one-word
// change here, and the nav, the pages and the routes all follow it.

import { normalizeTier } from '@/lib/tier'
import { canSeeNav } from '@/lib/feature-access'

export type PreviewFeature = 'on_sale' | 'amazon_live' | 'comparison' | 'shorts_mode' | 'first_comment' | 'brand_recap' | 'deal_aftercare' | 'post_refresh' | 'facebook_reels' | 'whole_video' | 'sold_campaigns' | 'liftoff_split' | 'earnings' | 'live_followup' | 'video_plan' | 'studio_upload' | 'facebook_setup' | 'group_queue' | 'trybe_outreach' | 'hashtag_trends' | 'drop' | 'video_qr' | 'deals_import'

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
  // Group Post Queue: Sponsored Products and Amazon videos in a batch, Group
  // first (SCOUT fills the post with the link), then a Page post linking to
  // it. Live for Pro 2026-10-16 (Seb: "the group post queue should go live").
  group_queue: 'labs',
  // TRYBE outreach: SCOUT reads TRYBE's Discover Brands, MVP drafts a first
  // message per brand, the creator approves the Ready to send list, SCOUT sends it slowly.
  // Opened to Pro 2026-10-08, in Find products (Seb: "unlock TRYBE for pro users").
  trybe_outreach: 'labs',
  // SCOUT reading TikTok Creative Center and Instagram's tag counts for the
  // hashtag engine (Seb, 2026-10-16). Admin while it is tested on real pages.
  hashtag_trends: 'admin',
  // Drop: drop finished videos, say once where each goes, press one Launch
  // (Liftoff for YouTube and Amazon, the blog after the video, TRYBE through
  // SCOUT). Opened to Pro 2026-10-18 for the first creator to test it, who was
  // being told to upgrade to the plan he already pays for.
  drop: 'labs',
  // QR codes burned into the YouTube cut, for viewers watching on a
  // television who cannot click a description link (docs/qr-on-youtube-plan).
  // Admin while it is tested: a published video cannot be reburned, so a
  // mistake here is permanent in somebody else's work.
  video_qr: 'admin',
  // Deals Hub file import: the member's own Deals Hub list, read in their
  // browser and never uploaded, turned into deal posts scheduled for each
  // deal's start (Seb, 2026-10-19). Admin while Seb tries it on his own file.
  deals_import: 'admin',
}

/** Every preview feature. A check can then ask which are still admin only
 *  instead of naming one, which goes stale the moment that one graduates. */
export const PREVIEW_FEATURES = Object.keys(OPEN_TO) as PreviewFeature[]

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

// ── TRYBE ON THE AMAZON PLAN (Seb, 2026-10-14: "build the amazon plan
// preview") ─────────────────────────────────────────────────────────────────
// Pro gets all of TRYBE. The Amazon plan gets Find brands to browse: the
// Amazon match, filters, priorities, stars and pass. Nothing that calls AI
// (messages, scripts, briefs, replies, fit checks) and nothing SCOUT sends or
// writes to the shared copy of TRYBE. Enforced on the server by action.

export type TrybeAccess = 'full' | 'preview' | 'none'

export function trybeAccess(rawTier: unknown): TrybeAccess {
  if (canUsePreview('trybe_outreach', rawTier)) return 'full'
  return normalizeTier(rawTier) === 'amazon' ? 'preview' : 'none'
}

/** The server actions the Amazon plan's preview may call (POST); the GET
 *  that loads the page is allowed too. Everything else is Pro. */
export const TRYBE_PREVIEW_ACTIONS: ReadonlySet<string> = new Set(['browse', 'star', 'pass', 'unskip', 'priorities'])
