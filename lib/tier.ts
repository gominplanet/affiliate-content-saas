// Plan set: trial (free, 5 posts lifetime, no card) / creator $49 / pro $199
// / admin (internal, unlimited). Field names preserved from the previous
// 5-tier model so every cap + social consumer keeps working unchanged.
export type Tier = 'trial' | 'creator' | 'pro' | 'admin'

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
  if (raw === 'trial' || raw === 'creator' || raw === 'pro' || raw === 'admin') return raw
  if (raw === 'starter') return 'creator'
  if (raw === 'growth') return 'pro'
  return DEFAULT_TIER // 'free', null, undefined, or any unknown value → trial
}

export type Social = 'facebook' | 'threads' | 'linkedin' | 'pinterest' | 'twitter' | 'bluesky' | 'telegram' | 'instagram'

export const TIERS = {
  trial:   {
    label: 'Free Trial',
    price: 0,
    regularPrice: 0,
    postsPerMonth: null as number | null,
    /** 5 posts LIFETIME (not monthly) — hard wall after the 5th, no card,
     *  no time limit. The "aha" run. */
    lifetimeMax: 5 as number | null,
    collabsPerMonth: 0 as number | null,
    /** Tied to the 5 Co-Pilot videos the trial covers. */
    thumbnailsPerMonth: 5 as number | null,
    metadataGensPerMonth: 5 as number | null,
    instagramAiThumbnailsPerMonth: 0 as number | null,
    /** Professional headshots (Photobooth) / month. Paid-tier feature. */
    photoboothPerMonth: 0 as number | null,
    /** Max saved faces a user can keep (0 = feature off for this tier). Bounds
     *  the gpt-image anchor COGS, since each face seeds cached anchors. */
    maxFaces: 0 as number | null,
    /** In-body blog images per post (hard ceiling — COGS guard). */
    blogImagesPerPost: 2,
    /** AI assistant chat messages / month (product help + coach). */
    assistantMessagesPerMonth: 20 as number | null,
    /** LoRA face-training jobs / month (0 = feature off). */
    faceTrainJobs: 0 as number | null,
    basePosts: 5,
    bonusPosts: 0,
    sites: 1,
    // Facebook + WordPress only on the trial; every other pill is locked.
    socials: ['facebook'] as readonly Social[],
    priorityQueue: false,
    prioritySupport: false,
    publishAll: false,
  },
  creator: {
    label: 'Creator',
    price: 49,
    regularPrice: 99,
    postsPerMonth: 40,
    lifetimeMax: null as number | null,
    // Taster cap — lets Creator users try the Pro Collaborations
    // workflow so they feel the upgrade pull naturally.
    collabsPerMonth: 5 as number | null,
    thumbnailsPerMonth: 40 as number | null,
    metadataGensPerMonth: 60 as number | null,
    instagramAiThumbnailsPerMonth: 0 as number | null,
    photoboothPerMonth: 10 as number | null,
    maxFaces: 2 as number | null,
    blogImagesPerPost: 3,
    assistantMessagesPerMonth: 200 as number | null,
    faceTrainJobs: 0 as number | null,
    basePosts: 40,
    bonusPosts: 0,
    sites: 1,
    socials: ['facebook', 'threads', 'linkedin', 'pinterest', 'bluesky'] as readonly Social[],
    priorityQueue: false,
    prioritySupport: false,
    publishAll: false,
  },
  pro:     {
    label: 'Pro',
    price: 199,
    regularPrice: 499,
    postsPerMonth: 200,
    lifetimeMax: null as number | null,
    collabsPerMonth: 100 as number | null,
    thumbnailsPerMonth: 300 as number | null,
    metadataGensPerMonth: 300 as number | null,
    instagramAiThumbnailsPerMonth: 50 as number | null,
    /** 20 professional headshots / month — bounds gpt-image COGS. */
    photoboothPerMonth: 20 as number | null,
    maxFaces: 2 as number | null,
    blogImagesPerPost: 4,
    // High enough to feel unlimited for normal daily use (~160/day) while
    // still bounding worst-case Haiku cost (~$25/mo at the ceiling).
    assistantMessagesPerMonth: 5000 as number | null,
    // 3 LoRA training jobs / month — bounded ($1.50/job has no natural
    // ceiling, so it's explicitly capped rather than uncapped).
    faceTrainJobs: 3 as number | null,
    basePosts: 140,
    bonusPosts: 60,
    sites: 1,
    socials: ['facebook', 'threads', 'linkedin', 'pinterest', 'twitter', 'bluesky', 'telegram', 'instagram'] as readonly Social[],
    priorityQueue: true,
    prioritySupport: true,
    publishAll: true,
  },
  admin:   {
    label: 'Admin',
    price: 0,
    regularPrice: 0,
    postsPerMonth: null as number | null,
    lifetimeMax: null as number | null,
    collabsPerMonth: null as number | null,
    thumbnailsPerMonth: null as number | null,
    metadataGensPerMonth: null as number | null,
    instagramAiThumbnailsPerMonth: null as number | null,
    photoboothPerMonth: null as number | null,
    maxFaces: null as number | null,
    blogImagesPerPost: 6,
    assistantMessagesPerMonth: null as number | null,
    faceTrainJobs: null as number | null,
    basePosts: 0,
    bonusPosts: 0,
    sites: 999,
    socials: ['facebook', 'threads', 'linkedin', 'pinterest', 'twitter', 'bluesky', 'telegram', 'instagram'] as readonly Social[],
    priorityQueue: true,
    prioritySupport: true,
    publishAll: true,
  },
} as const

/** In-body blog image ceiling for a post, scaled ~1 per 500 words and
 *  clamped to the tier's blogImagesPerPost. Single source of truth for
 *  the blog generator's image count. */
export function allowedBlogImages(tier: Tier, wordCount: number): number {
  const ceiling = TIERS[normalizeTier(tier)].blogImagesPerPost
  // A review reads best with ~2 photos; only a very long post earns a 3rd
  // (~1 image per 1500 words). Keeps single reviews from getting cluttered.
  const byLength = Math.round(wordCount / 1500)
  return Math.max(2, Math.min(ceiling, byLength))
}

/** Whether a given tier can publish to a specific social platform. */
export function tierAllowsSocial(tier: Tier, social: Social): boolean {
  return TIERS[normalizeTier(tier)].socials.includes(social)
}

/** Next-tier upgrade hint for capped actions. Returns null when the
 *  user is already on Pro / Admin (no upward path). Used by routes to
 *  build a "Upgrade to Pro → 300 thumbnails / mo" call-to-action when
 *  a user hits a cap. */
export function nextTierFor(
  tier: Tier,
  cap: 'postsPerMonth' | 'collabsPerMonth' | 'thumbnailsPerMonth' | 'metadataGensPerMonth' | 'instagramAiThumbnailsPerMonth',
): { tier: Tier; label: string; limit: number | null } | null {
  tier = normalizeTier(tier)
  const order: Tier[] = ['trial', 'creator', 'pro']
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
  const { data: ig } = await (supabase as any)
    .from('integrations')
    .select('tier,subscription_period_start,subscription_period_end')
    .eq('user_id', userId)
    .single()

  const tier = normalizeTier(ig?.tier)
  const limits = TIERS[tier]

  // Admin — unlimited
  if (tier === 'admin') return { allowed: true }

  // Free tier — 15 posts lifetime
  if (limits.lifetimeMax !== null) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { count } = await (supabase as any)
      .from('blog_posts')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)

    if ((count ?? 0) >= limits.lifetimeMax) {
      const next = nextTierFor(tier, 'postsPerMonth')
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
    return { allowed: true }
  }

  if (limits.postsPerMonth !== null) {
    const { startISO, resetLabel } = billingWindow({
      periodStart: ig?.subscription_period_start ?? null,
      periodEnd: ig?.subscription_period_end ?? null,
    })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { count } = await (supabase as any)
      .from('blog_posts')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .gte('published_at', startISO)

    if ((count ?? 0) >= limits.postsPerMonth) {
      const next = nextTierFor(tier, 'postsPerMonth')
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
  }

  return { allowed: true }
}
