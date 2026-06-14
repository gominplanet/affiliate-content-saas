// Plan set: trial (free, 5 posts lifetime, no card) / creator $49 / studio $99
// / pro $199 / admin (internal, unlimited).
//
// Rewritten 2026-06-04 per tier-restructure session. Key changes:
//   - Generation caps DROPPED for paid tiers (Creator 40→20, Studio 80→60,
//     Pro unchanged at 200). Tier copy now sells "blog + thumbnail +
//     metadata" as a bundle that burns 1 unit; postsPerMonth /
//     thumbnailsPerMonth / metadataGensPerMonth all read the same cap.
//     True atomic shared counter is a follow-up RPC (see follow-up task).
//   - Scripts open to Creator (10/mo), Studio (30/mo), Pro (150/mo).
//   - LoRA training opens to Creator + Studio (was Pro-only).
//   - Deals Hub gets its own counter: Studio 5/mo, Pro 30/mo.
//   - IG AI thumbnails opens to Studio (30/mo, was Pro-only).
//   - Topic hubs / Refresh images go to Studio+.
//   - Comparison posts / Buying guides / Rebuild-from-video → Pro-only.
//   - Newsletter access opens to Creator (taster: 500 subs, 1 send/mo);
//     Studio = weekly (5k/4); Pro = twice-weekly (10k/8).
//   - Newsletter A/B + Segmented = Pro-only; Scheduling = Studio+.
//   - Social matrix per tier:
//       Creator: LinkedIn, Bluesky, Pinterest, Facebook*, Threads*
//       Studio: + Instagram*, Telegram
//       Pro:    + Twitter, TikTok*
//       (* = pending external app-review gate, separate from tier gate)
//   - VA seats: Pro 3 with granular perms.
//   - API access + White-label: still Pro-only but HIDDEN from nav until
//     real demand surfaces (route + page stay alive).
//   - Priority queue + Discord priority support: Studio + Pro.
export type Tier = 'trial' | 'creator' | 'studio' | 'pro' | 'admin'

/** Default tier for a brand-new account (no Stripe subscription yet). */
export const DEFAULT_TIER: Tier = 'trial'

/**
 * Coerce any stored tier value into a valid Tier. DB rows can hold null or
 * pre-migration values ('free', 'starter', 'growth'); a bare `?? 'trial'`
 * only catches null/undefined, so a legacy string would slip through and make
 * `TIERS[tier]` undefined — which crashed generation with
 * "cannot read properties of undefined (reading 'lifetimeMax')".
 * Map legacy values to their new equivalents; anything unknown → DEFAULT_TIER.
 */
export function normalizeTier(raw: unknown): Tier {
  if (
    raw === 'trial' ||
    raw === 'creator' ||
    raw === 'studio' ||
    raw === 'pro' ||
    raw === 'admin'
  ) return raw
  if (raw === 'starter') return 'creator'
  if (raw === 'growth') return 'pro'
  return DEFAULT_TIER // 'free', null, undefined, or any unknown value → trial
}

export type Social = 'facebook' | 'threads' | 'linkedin' | 'pinterest' | 'twitter' | 'bluesky' | 'telegram' | 'instagram' | 'tiktok'

export const TIERS = {
  trial:   {
    label: 'Free Trial',
    price: 0,
    regularPrice: 0,
    /** Hard monthly AI-spend ceiling (USD of real ai_usage cost). When an
     *  account crosses this in a calendar month, generation is paused with an
     *  upgrade nudge — a circuit breaker on top of the per-feature caps,
     *  catching runaways + uncapped admin testing (the overnight-$60 case).
     *  Set ~2× the expected max so normal users never hit it. null = no ceiling. */
    monthlyAiSpendCeilingUsd: 5 as number | null,
    /** Shared "Generations" counter: blog + thumbnail + metadata each
     *  burn 1 unit. Trial is gated by lifetimeMax below, not monthly. */
    postsPerMonth: null as number | null,
    /** 5 posts LIFETIME (not monthly) — hard wall after the 5th, no card,
     *  no time limit. The "aha" run. */
    lifetimeMax: 5 as number | null,
    collabsPerMonth: 0 as number | null,
    /** Tied to the 5 Co-Pilot videos the trial covers. Shares the same
     *  bucket as postsPerMonth — the cap value mirrors it. */
    thumbnailsPerMonth: 5 as number | null,
    metadataGensPerMonth: 5 as number | null,
    instagramAiThumbnailsPerMonth: 0 as number | null,
    /** Deal posts (Amazon CSV + single-link form share this bucket). */
    dealsPerMonth: 0 as number | null,
    photoboothPerMonth: 0 as number | null,
    maxFaces: 0 as number | null,
    blogImagesPerPost: 2,
    assistantMessagesPerMonth: 20 as number | null,
    faceTrainJobs: 0 as number | null,
    /** Newsletter is Creator-min as of 2026-06-04 tier restructure. Trial
     *  loses the 100 subs / 1 broadcast taster — sees FeatureLockedCard. */
    newsletterSubscribers: 0 as number | null,
    newsletterBroadcastsPerMonth: 0 as number | null,
    /** Newsletter feature flags. */
    newsletterScheduling: false,
    newsletterABTesting: false,
    newsletterSegmentedSends: false,
    /** Pre-production: video script & shot list. Separate counter from
     *  postsPerMonth (different point in the workflow — before video). */
    scriptsPerMonth: 0 as number | null,
    /** Content-type gates. */
    comparisonPosts: false,
    buyingGuides: false,
    topicHubs: false,
    refreshImages: false,
    rebuildFromVideo: false,
    basePosts: 5,
    bonusPosts: 0,
    sites: 1,
    youtubeChannels: 1,
    socials: [] as readonly Social[],
    multiAccountSocial: false,
    publishAll: false,
    /** Cascade-only schedules per month — distinct blog_posts you can
     *  queue a "social cascade for already-live post" against. Per-post
     *  re-schedules don't count again. Null = unlimited. The
     *  schedule-cascade-only route enforces this server-side (2026-06-07). */
    cascadeOnlySchedulesPerMonth: 5 as number | null,
    /** Power-user / Pro-only gates. */
    campaigns: false,
    apiAccess: false,
    whiteLabel: false,
    vaSeats: 0,
    priorityQueue: false,
    prioritySupport: false,
  },
  creator: {
    label: 'Creator',
    price: 49,
    regularPrice: 99,
    /** Monthly AI-spend circuit breaker (USD of real ai_usage cost) — see trial. */
    monthlyAiSpendCeilingUsd: 15 as number | null,
    /** Shared counter: 20 generations/mo across blog + thumbnail + metadata.
     *  Each path currently enforces its own cap at this value (true atomic
     *  shared bucket is a follow-up RPC — see TASK_X). */
    postsPerMonth: 20,
    lifetimeMax: null as number | null,
    collabsPerMonth: 5 as number | null,
    thumbnailsPerMonth: 20 as number | null,
    metadataGensPerMonth: 20 as number | null,
    instagramAiThumbnailsPerMonth: 0 as number | null,
    dealsPerMonth: 0 as number | null,
    photoboothPerMonth: 10 as number | null,
    maxFaces: 1 as number | null,
    blogImagesPerPost: 3,
    assistantMessagesPerMonth: 200 as number | null,
    /** Creator gets 1 LoRA retrain/mo — train your face once, the LoRA
     *  reused freely across all 20 thumbnails. Retrain cap protects MVP
     *  from someone hammering trainer dozens of times. */
    faceTrainJobs: 1 as number | null,
    /** Taster newsletter: 500 subs, 1 send/mo. Subs at the cap = upsell
     *  pull to Studio (5k subs). */
    newsletterSubscribers: 500 as number | null,
    newsletterBroadcastsPerMonth: 1 as number | null,
    newsletterScheduling: false,
    newsletterABTesting: false,
    newsletterSegmentedSends: false,
    /** Video Scripts open to Creator at 10/mo (was 0). */
    scriptsPerMonth: 10 as number | null,
    comparisonPosts: false,
    buyingGuides: false,
    topicHubs: false,
    refreshImages: false,
    rebuildFromVideo: false,
    basePosts: 20,
    bonusPosts: 0,
    sites: 1,
    youtubeChannels: 1,
    /** Creator unlocks: LinkedIn, Bluesky, Pinterest, Facebook*, Threads*
     *  (* = Meta App Review still gating these for non-admin/non-reviewer
     *  users — see app-review middleware). */
    socials: ['linkedin', 'bluesky', 'pinterest', 'facebook', 'threads'] as readonly Social[],
    multiAccountSocial: false,
    publishAll: false,
    cascadeOnlySchedulesPerMonth: 30 as number | null,
    campaigns: false,
    apiAccess: false,
    whiteLabel: false,
    vaSeats: 0,
    priorityQueue: false,
    prioritySupport: false,
  },
  studio:  {
    label: 'Studio',
    price: 99,
    regularPrice: 199,
    /** Monthly AI-spend circuit breaker (USD of real ai_usage cost) — see trial. */
    monthlyAiSpendCeilingUsd: 40 as number | null,
    /** Shared counter: 60 generations/mo. */
    postsPerMonth: 60,
    lifetimeMax: null as number | null,
    collabsPerMonth: 15 as number | null,
    thumbnailsPerMonth: 60 as number | null,
    metadataGensPerMonth: 60 as number | null,
    /** IG AI thumbnails open to Studio at 30/mo (was Pro-only). */
    instagramAiThumbnailsPerMonth: 30 as number | null,
    /** Studio gets 5 deal posts / mo. Separate counter from blog. */
    dealsPerMonth: 5 as number | null,
    photoboothPerMonth: 15 as number | null,
    maxFaces: 2 as number | null,
    blogImagesPerPost: 3,
    assistantMessagesPerMonth: 1000 as number | null,
    /** LoRA training opens to Studio at 3/mo (was Pro-only). */
    faceTrainJobs: 3 as number | null,
    /** Weekly newsletter cadence: 5k subs, 4 sends/mo. */
    newsletterSubscribers: 5000 as number | null,
    newsletterBroadcastsPerMonth: 4 as number | null,
    /** Scheduling opens to Studio. A/B + Segments stay Pro-only. */
    newsletterScheduling: true,
    newsletterABTesting: false,
    newsletterSegmentedSends: false,
    scriptsPerMonth: 30 as number | null,
    /** Studio gates. */
    comparisonPosts: false,
    buyingGuides: false,
    topicHubs: true,
    refreshImages: true,
    rebuildFromVideo: false,
    basePosts: 60,
    bonusPosts: 0,
    sites: 1,
    youtubeChannels: 1,
    /** Studio = Creator's + Instagram* + Telegram. */
    socials: ['linkedin', 'bluesky', 'pinterest', 'facebook', 'threads', 'instagram', 'telegram'] as readonly Social[],
    multiAccountSocial: false,
    publishAll: false,
    cascadeOnlySchedulesPerMonth: null as number | null,
    campaigns: false,
    apiAccess: false,
    whiteLabel: false,
    vaSeats: 0,
    /** Priority queue + Discord priority support kick in at Studio. */
    priorityQueue: true,
    prioritySupport: true,
  },
  pro:     {
    label: 'Pro',
    price: 199,
    regularPrice: 499,
    /** Monthly AI-spend circuit breaker (USD of real ai_usage cost) — see trial.
     *  Lowered 120 → 90 (2026-06-14 margin tune): 200 image-posts cost ~$124
     *  so the old $120 ceiling already gated before the cap; $90 lifts Pro's
     *  worst-case margin from 40% → ~55% while still covering ~145 image-posts
     *  or ~180 text-posts/mo — far more than any real Pro user generates. The
     *  spendGate ceiling, not postsPerMonth, is the true cost cap. */
    monthlyAiSpendCeilingUsd: 90 as number | null,
    /** Shared counter: 200 generations/mo (headline value; the spend ceiling
     *  above is the real limiter for the rare power user). */
    postsPerMonth: 200,
    lifetimeMax: null as number | null,
    collabsPerMonth: 100 as number | null,
    thumbnailsPerMonth: 200 as number | null,
    metadataGensPerMonth: 200 as number | null,
    instagramAiThumbnailsPerMonth: 100 as number | null,
    /** Pro: 30 deal posts/mo (revised down from 90 → 60 → 30 for COGS). */
    dealsPerMonth: 30 as number | null,
    photoboothPerMonth: 20 as number | null,
    maxFaces: 2 as number | null,
    blogImagesPerPost: 4,
    assistantMessagesPerMonth: 2500 as number | null,
    /** Pro: 3 LoRA retrains/mo (lowered from 5 — 2026-06-10 COGS tune). */
    faceTrainJobs: 3 as number | null,
    /** Weekly cadence: 10k subs, 4 sends/mo. Lowered 8 → 4 (2026-06-14): at
     *  10k subs, 8 sends = 80k Resend emails/mo (~$30) — a real cash cost that
     *  sits OUTSIDE the AI-spend ceiling. 4 sends (weekly) is still generous
     *  and roughly halves that bill. */
    newsletterSubscribers: 10000 as number | null,
    newsletterBroadcastsPerMonth: 4 as number | null,
    /** Pro newsletter unlocks: Scheduling (inherited), A/B subject lines,
     *  Segmented sends (segment-builder UI is a follow-up task). */
    newsletterScheduling: true,
    newsletterABTesting: true,
    newsletterSegmentedSends: true,
    scriptsPerMonth: 150 as number | null,
    /** Pro content-type gates. */
    comparisonPosts: true,
    buyingGuides: true,
    topicHubs: true,
    refreshImages: true,
    rebuildFromVideo: true,
    basePosts: 140,
    bonusPosts: 60,
    /** Pro multi-site: up to 10 WP sites. */
    sites: 10,
    /** Pro multi-channel: connect multiple YouTube channels (one default per WP site, plus pull from others). */
    youtubeChannels: 10,
    /** Pro = Studio's + Twitter + TikTok*. */
    socials: ['linkedin', 'bluesky', 'pinterest', 'facebook', 'threads', 'instagram', 'telegram', 'twitter', 'tiktok'] as readonly Social[],
    /** Multi-account social: per-post FB Page / IG account picker. */
    multiAccountSocial: true,
    publishAll: true,
    cascadeOnlySchedulesPerMonth: null as number | null,
    campaigns: true,
    /** API access HIDDEN from nav for now (link commented out in
     *  DashboardShellV2 until real demand surfaces). White-label is OFF —
     *  not offered or on the roadmap for now (2026-06-10): the /branding UI
     *  404s and it's not advertised anywhere. */
    apiAccess: true,
    whiteLabel: false,
    /** VA / Agency seats: up to 3 invitees with granular permissions. */
    vaSeats: 3,
    priorityQueue: true,
    prioritySupport: true,
  },
  admin:   {
    label: 'Admin',
    price: 0,
    regularPrice: 0,
    /** Even internal/admin accounts get a ceiling — this is the lever that
     *  catches the uncapped-testing overnight-$60 case. Generous, not infinite. */
    monthlyAiSpendCeilingUsd: 150 as number | null,
    postsPerMonth: null as number | null,
    lifetimeMax: null as number | null,
    collabsPerMonth: null as number | null,
    thumbnailsPerMonth: null as number | null,
    metadataGensPerMonth: null as number | null,
    instagramAiThumbnailsPerMonth: null as number | null,
    dealsPerMonth: null as number | null,
    photoboothPerMonth: null as number | null,
    maxFaces: null as number | null,
    blogImagesPerPost: 6,
    assistantMessagesPerMonth: null as number | null,
    faceTrainJobs: null as number | null,
    newsletterSubscribers: null as number | null,
    newsletterBroadcastsPerMonth: null as number | null,
    newsletterScheduling: true,
    newsletterABTesting: true,
    newsletterSegmentedSends: true,
    scriptsPerMonth: null as number | null,
    comparisonPosts: true,
    buyingGuides: true,
    topicHubs: true,
    refreshImages: true,
    rebuildFromVideo: true,
    basePosts: 0,
    bonusPosts: 0,
    sites: 999,
    youtubeChannels: 999,
    socials: ['facebook', 'threads', 'linkedin', 'pinterest', 'twitter', 'bluesky', 'telegram', 'instagram', 'tiktok'] as readonly Social[],
    multiAccountSocial: true,
    publishAll: true,
    cascadeOnlySchedulesPerMonth: null as number | null,
    campaigns: true,
    apiAccess: true,
    whiteLabel: true,
    vaSeats: 999,
    priorityQueue: true,
    prioritySupport: true,
  },
} as const

/** In-body blog image ceiling for a post. Single source of truth for
 *  the blog generator's image count.
 *
 *  - If the user set `brand_profiles.blog_image_count` explicitly
 *    (0..4), respect it — clamped to the tier ceiling so a Trial user
 *    can't pick 4. Including 0 (no in-body images at all).
 *  - Otherwise fall back to the legacy word-count-scaled default
 *    (~1 image per 1500 words, min 2, clamped to tier ceiling).
 *
 *  Added userPreference parameter 2026-06-07. */
export function allowedBlogImages(
  tier: Tier,
  wordCount: number,
  userPreference?: number | null,
): number {
  // HARD COST CAP (2026-06-12): at most ONE in-body image per 750 words, on
  // top of the tier ceiling and any user preference. Posts are capped at 1,500
  // words, so this resolves to 1 (≤750w) or 2 (751–1,500w). Replaces the old
  // "1 per 1,500 words, minimum 2" rule that over-generated images.
  const wordCap = Math.max(1, Math.ceil((wordCount || 0) / 750))
  const ceiling = Math.min(TIERS[normalizeTier(tier)].blogImagesPerPost, wordCap)
  if (typeof userPreference === 'number' && userPreference >= 0) {
    // User has an explicit preference — respect it, clamped to the (now
    // word-capped) ceiling. 0 is valid and means "no in-body images".
    return Math.min(ceiling, userPreference)
  }
  // Default when images are requested: the full word-scaled allowance.
  return ceiling
}

/** Whether a given tier can publish to a specific social platform. */
export function tierAllowsSocial(tier: Tier, social: Social): boolean {
  return TIERS[normalizeTier(tier)].socials.includes(social)
}

/** Newsletter subscriber cap for the given tier. null = unlimited (admin).
 *  Used by /api/newsletter/subscribe to reject new sign-ups past the cap
 *  with an upgrade nudge instead of silently dropping them.
 *
 *  Grandfathering: pass { legacyCreatorNewsletter: true } to return the
 *  pre-2026-06-04 cap (1000) for Creator users who were paying when the
 *  cap was lowered. The flag is stored on integrations.legacy_creator_newsletter
 *  and set true for any Creator with an active Stripe sub at migration
 *  100 run time. No-op for other tiers. */
export function allowedNewsletterSubscribers(
  tier: Tier,
  opts?: { legacyCreatorNewsletter?: boolean },
): number | null {
  const t = normalizeTier(tier)
  if (opts?.legacyCreatorNewsletter && t === 'creator') return 1000
  return TIERS[t].newsletterSubscribers
}

/** Newsletter broadcast-send cap per billing month. null = unlimited. Used
 *  by /api/newsletter/send to gate the send button + render the upgrade
 *  banner once the creator hits the ceiling.
 *
 *  Grandfathering: same pattern as allowedNewsletterSubscribers — legacy
 *  Creator users get the pre-2026-06-04 cap (4/month) when the
 *  legacyCreatorNewsletter flag is true. */
export function allowedNewsletterBroadcasts(
  tier: Tier,
  opts?: { legacyCreatorNewsletter?: boolean },
): number | null {
  const t = normalizeTier(tier)
  if (opts?.legacyCreatorNewsletter && t === 'creator') return 4
  return TIERS[t].newsletterBroadcastsPerMonth
}

/** Unified "generations per billing month" cap across blog posts, YouTube
 *  thumbnails, and YouTube metadata. The 2026-06-04 restructure declared
 *  these one bundle (Creator 20, Studio 60, Pro 200) but each route
 *  enforced its own cap independently — letting a Creator burn 60. The
 *  RPC try_consume_generation_quota() (migration 101) sums all three
 *  counters under a per-user lock; this helper returns the cap value to
 *  pass into it. Reads the postsPerMonth slot since the three numbers
 *  are deliberately mirrored. */
export function allowedGenerationsPerMonth(tier: Tier): number | null {
  return TIERS[normalizeTier(tier)].postsPerMonth
}

/** Generic feature-flag lookup. Cleaner than scattering `tier === 'pro'`
 *  checks across routes; reads one source of truth. Use for boolean gates:
 *    tierHas(tier, 'comparisonPosts') / 'buyingGuides' / 'rebuildFromVideo' /
 *    'topicHubs' / 'refreshImages' / 'newsletterScheduling' /
 *    'newsletterABTesting' / 'newsletterSegmentedSends' / 'campaigns' /
 *    'apiAccess' / 'whiteLabel' / 'multiAccountSocial' / 'publishAll' /
 *    'priorityQueue' / 'prioritySupport'.
 *
 *  Numeric caps stay on TIERS[tier].X directly — this helper is for booleans
 *  + the few "feature-on/off" flags where the answer is yes/no, not how-many. */
export function tierHas(
  tier: Tier,
  key:
    | 'comparisonPosts'
    | 'buyingGuides'
    | 'topicHubs'
    | 'refreshImages'
    | 'rebuildFromVideo'
    | 'newsletterScheduling'
    | 'newsletterABTesting'
    | 'newsletterSegmentedSends'
    | 'campaigns'
    | 'apiAccess'
    | 'whiteLabel'
    | 'multiAccountSocial'
    | 'publishAll'
    | 'priorityQueue'
    | 'prioritySupport',
): boolean {
  return TIERS[normalizeTier(tier)][key]
}

/** Next-tier upgrade hint for capped actions. Returns null when the
 *  user is already on Pro / Admin (no upward path). Used by routes to
 *  build a "Upgrade to Pro → 300 thumbnails / mo" call-to-action when
 *  a user hits a cap. */
export function nextTierFor(
  tier: Tier,
  cap: 'postsPerMonth' | 'collabsPerMonth' | 'thumbnailsPerMonth' | 'metadataGensPerMonth' | 'instagramAiThumbnailsPerMonth' | 'scriptsPerMonth' | 'dealsPerMonth',
): { tier: Tier; label: string; limit: number | null } | null {
  tier = normalizeTier(tier)
  const order: Tier[] = ['trial', 'creator', 'studio', 'pro']
  const idx = order.indexOf(tier)
  if (idx < 0 || idx === order.length - 1) return null
  // Find the next tier that actually offers MORE of this cap (or unlimited).
  for (let i = idx + 1; i < order.length; i++) {
    const next = order[i]
    const currentLimit = TIERS[tier][cap]
    const nextLimit = TIERS[next][cap]
    // Unlimited (null) beats any number; a higher cap beats a lower one.
    if (nextLimit === null || (currentLimit !== null && nextLimit > currentLimit)) {
      return { tier: next, label: TIERS[next].label, limit: nextLimit }
    }
  }
  return null
}

/** Whether a given tier can use the one-click Publish All flow. */
export function tierAllowsPublishAll(tier: Tier): boolean {
  return TIERS[normalizeTier(tier)].publishAll
}

/** Whether a tier can use Creator Campaigns (Amazon Creator Connections +
 *  EPC scouting → research/write/publish). Pro-only. Explicit gate — do
 *  NOT proxy this off a social-platform check. */
export function tierAllowsCampaigns(tier: Tier): boolean {
  return tier === 'pro' || tier === 'admin'
}

/**
 * The user's current quota window. Paid subscribers get their actual
 * Stripe billing cycle (period_start → period_end), so a user who
 * subscribed on the 14th sees their quota reset on the 14th, not the
 * 1st. Falls back to calendar-month when those columns are null — free
 * tier, no Stripe subscription yet, or legacy rows before we started
 * capturing period_start (migration 041).
 *
 * Single source of truth: enforcement (checkUsageLimit, collab cap)
 * and the dashboard Plan & usage card all read this so they can't
 * disagree about the window or the displayed reset date.
 */
export function billingWindow(opts: {
  periodStart?: string | null
  periodEnd?: string | null
}): { startISO: string; resetLabel: string } {
  const fmt = (d: Date) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  if (opts.periodStart) {
    return {
      startISO: new Date(opts.periodStart).toISOString(),
      resetLabel: opts.periodEnd ? fmt(new Date(opts.periodEnd)) : 'your next billing date',
    }
  }
  const now = new Date()
  const startISO = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString()
  const reset = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1))
  return { startISO, resetLabel: fmt(reset) }
}

// Returns { allowed: true } or { allowed: false, reason, tier, upgrade? }
export async function checkUsageLimit(
  supabase: Awaited<ReturnType<typeof import('@/lib/supabase/server').createServerClient>>,
  userId: string,
): Promise<
  | { allowed: true }
  | { allowed: false; reason: string; tier: Tier; upgrade: ReturnType<typeof nextTierFor> }
> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: ig } = await supabase
    .from('integrations')
    .select('tier,subscription_period_start,subscription_period_end')
    .eq('user_id', userId)
    .single()

  const tier = normalizeTier(ig?.tier)
  const limits = TIERS[tier]

  // Admin — unlimited
  if (tier === 'admin') return { allowed: true }

  // The actual gate goes through try_consume_post_quota() (migration 080) —
  // a Postgres function that takes a per-user advisory lock + counts + decides
  // atomically. Replaces the old check-then-write pattern that let two
  // concurrent generates both pass when the user was 1 below their cap.
  //
  // resetLabel is computed here (NOT in SQL) so we can render the
  // user-friendly "Resets Jun 1" string in the error message regardless of
  // which gate path we took.
  const { startISO, resetLabel } = billingWindow({
    periodStart: ig?.subscription_period_start ?? null,
    periodEnd: ig?.subscription_period_end ?? null,
  })

  // The RPC's bigint params can't be null; null in our tier config means
  // "no cap" (admin). Coerce to a number bigger than any real monthly
  // post volume so the SQL UPDATE ... < cap predicate always passes.
  const NO_CAP = 1_000_000_000
  const { data: ok } = await supabase.rpc('try_consume_post_quota', {
    p_user: userId,
    p_lifetime: limits.lifetimeMax ?? NO_CAP,
    p_monthly: limits.postsPerMonth ?? NO_CAP,
    p_window_start: startISO,
  })

  if (ok === true) return { allowed: true }

  // Quota denied — build the right reason string based on whether the cap
  // was a lifetime or monthly one.
  const next = nextTierFor(tier, 'postsPerMonth')
  if (limits.lifetimeMax !== null) {
    const nextHint = next
      ? ` Upgrade to ${next.label} for ${next.limit === null ? 'unlimited' : `${next.limit} posts / month`}.`
      : ''
    return {
      allowed: false,
      reason: `You've used all ${limits.lifetimeMax} free posts.${nextHint}`,
      tier,
      upgrade: next,
    }
  }
  if (limits.postsPerMonth !== null) {
    const nextHint = next
      ? ` Upgrade to ${next.label} for ${next.limit === null ? 'unlimited' : `${next.limit} / month`}.`
      : ''
    return {
      allowed: false,
      reason: `You've reached your ${limits.postsPerMonth} posts limit on the ${limits.label} plan for this billing period.${nextHint} Resets ${resetLabel}.`,
      tier,
      upgrade: next,
    }
  }

  // No cap configured but the RPC returned false — shouldn't happen, but
  // fail-closed and surface a generic message.
  return {
    allowed: false,
    reason: 'Post quota check failed. Try again in a moment.',
    tier,
    upgrade: next,
  }
}

/**
 * Video Script & Shot List monthly cap. Counts rows in `video_scripts` for
 * this user since the 1st of the current UTC month, against the tier's
 * `scriptsPerMonth`. Creator+ tiers all have access now (Creator 10/mo,
 * Studio 30/mo, Pro 150/mo) — trial returns "feature off" since trial is
 * onboarding-only.
 *
 * Returns the current count + cap on success too, so the page can render a
 * "X of 30 used this month" meter without a second query.
 */
export async function checkScriptUsage(
  supabase: Awaited<ReturnType<typeof import('@/lib/supabase/server').createServerClient>>,
  userId: string,
): Promise<
  | { allowed: true; tier: Tier; used: number; cap: number | null; resetLabel: string }
  | { allowed: false; reason: string; tier: Tier; used: number; cap: number | null; upgrade: ReturnType<typeof nextTierFor> }
> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: ig } = await supabase
    .from('integrations')
    .select('tier')
    .eq('user_id', userId)
    .single()
  const tier = normalizeTier(ig?.tier)
  const cap = TIERS[tier].scriptsPerMonth

  // Calendar month window — independent of billing cycle on purpose; the
  // script cap is small enough that a billing-aligned reset would feel arbitrary
  // to users.
  const now = new Date()
  const startISO = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString()
  const resetLabel = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1))
    .toLocaleDateString('en-US', { month: 'short', day: 'numeric' })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { count } = await supabase
    .from('video_scripts')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .gte('created_at', startISO)
  const used = count ?? 0

  // Admin — uncapped (cap === null).
  if (cap === null) return { allowed: true, tier, used, cap: null, resetLabel }

  // Tiers with cap === 0 (trial only now — Creator opened to 10/mo in the
  // 2026-06-04 tier restructure) → upsell instead of usage block.
  if (cap === 0) {
    const next = nextTierFor(tier, 'scriptsPerMonth')
    return {
      allowed: false,
      reason: 'Video scripts are a paid-tier feature. Upgrade to start generating film-ready scripts in your voice.',
      tier,
      used: 0,
      cap: 0,
      upgrade: next,
    }
  }

  if (used >= cap) {
    return {
      allowed: false,
      reason: `You've used all ${cap} scripts this month on the ${TIERS[tier].label} plan. Resets ${resetLabel}.`,
      tier,
      used,
      cap,
      upgrade: nextTierFor(tier, 'scriptsPerMonth'),
    }
  }

  return { allowed: true, tier, used, cap, resetLabel }
}

/**
 * Deals Hub monthly cap. Counts rows in `blog_posts` where post_type='deal'
 * (or deal_meta IS NOT NULL) since the start of the user's billing window.
 * Studio 5/mo, Pro 30/mo. Creator + Trial return "feature off" → upsell.
 */
export async function checkDealsUsage(
  supabase: Awaited<ReturnType<typeof import('@/lib/supabase/server').createServerClient>>,
  userId: string,
): Promise<
  | { allowed: true; tier: Tier; used: number; cap: number | null; resetLabel: string }
  | { allowed: false; reason: string; tier: Tier; used: number; cap: number | null; upgrade: ReturnType<typeof nextTierFor> }
> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: ig } = await supabase
    .from('integrations')
    .select('tier,subscription_period_start,subscription_period_end')
    .eq('user_id', userId)
    .single()
  const tier = normalizeTier(ig?.tier)
  const cap = TIERS[tier].dealsPerMonth
  const { startISO, resetLabel } = billingWindow({
    periodStart: ig?.subscription_period_start ?? null,
    periodEnd: ig?.subscription_period_end ?? null,
  })

  // Admin — uncapped.
  if (cap === null) return { allowed: true, tier, used: 0, cap: null, resetLabel }

  // Studio + Pro have caps > 0. Trial + Creator have cap 0 → upsell card.
  if (cap === 0) {
    return {
      allowed: false,
      reason: 'Deals Hub is a Studio + Pro feature. Upgrade to publish timely deal posts with countdown banners and bulk-import from your Amazon Associates dashboard.',
      tier,
      used: 0,
      cap: 0,
      upgrade: nextTierFor(tier, 'dealsPerMonth'),
    }
  }

  // Count deal posts in window. deal_meta column is on blog_posts
  // (migration 093). post_type='deal' is the canonical signal.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { count } = await supabase
    .from('blog_posts')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('post_type', 'deal')
    .gte('created_at', startISO)
  const used = count ?? 0

  if (used >= cap) {
    return {
      allowed: false,
      reason: `You've used all ${cap} deal posts this month on the ${TIERS[tier].label} plan. Resets ${resetLabel}.`,
      tier,
      used,
      cap,
      upgrade: nextTierFor(tier, 'dealsPerMonth'),
    }
  }

  return { allowed: true, tier, used, cap, resetLabel }
}

/**
 * Unified generation cap check across blog, YouTube thumbnail, and
 * YouTube metadata. Wraps the try_consume_generation_quota() RPC
 * (migration 101) so all three routes go through one chokepoint.
 *
 * Replaces the previous per-route gates that each enforced
 * postsPerMonth / thumbnailsPerMonth / metadataGensPerMonth
 * independently — that pattern let a Creator burn 20 of each = 60
 * ops/mo instead of the intended 20.
 *
 * `units` matters because the thumbnail route supports N variants per
 * call (variantCount=1..10). Pass variantCount so the pre-flight
 * accounts for the full batch the user is asking for, not just one.
 *
 * Returns the same shape as checkUsageLimit so route migration is a
 * straight swap.
 */
export async function checkGenerationLimit(
  supabase: Awaited<ReturnType<typeof import('@/lib/supabase/server').createServerClient>>,
  userId: string,
  opts: { units?: number } = {},
): Promise<
  | { allowed: true }
  | { allowed: false; reason: string; tier: Tier; upgrade: ReturnType<typeof nextTierFor> }
> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: ig } = await supabase
    .from('integrations')
    .select('tier,subscription_period_start,subscription_period_end')
    .eq('user_id', userId)
    .single()
  const tier = normalizeTier(ig?.tier)

  // Admin — unlimited, never gated.
  if (tier === 'admin') return { allowed: true }

  const limit = allowedGenerationsPerMonth(tier)
  // null = unlimited (admin only — handled above; this is a safety net).
  if (limit === null) return { allowed: true }

  const { startISO, resetLabel } = billingWindow({
    periodStart: ig?.subscription_period_start ?? null,
    periodEnd: ig?.subscription_period_end ?? null,
  })

  const units = Math.max(1, opts.units ?? 1)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: ok } = await (supabase as any).rpc('try_consume_generation_quota', {
    p_user: userId,
    p_monthly: limit,
    p_window_start: startISO,
    p_units: units,
  })

  if (ok === true) return { allowed: true }

  const next = nextTierFor(tier, 'postsPerMonth')
  const nextHint = next
    ? ` Upgrade to ${next.label} for ${next.limit === null ? 'unlimited' : `${next.limit}/month`}.`
    : ''
  return {
    allowed: false,
    reason: `You've reached your ${limit} generations cap this billing period. Generations include blog posts, YouTube thumbnails, and YouTube metadata.${nextHint} Resets ${resetLabel}.`,
    tier,
    upgrade: next,
  }
}
