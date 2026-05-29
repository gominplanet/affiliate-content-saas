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
    /** Newsletter (Milestone 1+): max total subscribers the trial can keep on
     *  their list. Hard cap — once reached, new sign-ups are rejected with
     *  a friendly "this newsletter is full" message rather than silently
     *  dropping them. */
    newsletterSubscribers: 100 as number | null,
    /** Newsletter: max broadcast SENDS per billing month. The trial gets one
     *  send so they can see the full compose → blast loop, but won't spam. */
    newsletterBroadcastsPerMonth: 1 as number | null,
    /** Video Script & Shot List generations per calendar month. 0 = feature
     *  off for this tier; users see a Pro-feature upsell on /script instead
     *  of the generator. Bounds Sonnet token spend on the pre-production
     *  tool. */
    scriptsPerMonth: 0 as number | null,
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
    /** Newsletter: Creator-tier subscriber + broadcast caps. At the cap (1,000
     *  subs × 4 broadcasts = 4,000 emails/mo) MVP's Resend cost is ~$1.60 —
     *  trivial fraction of $49 MRR. */
    newsletterSubscribers: 1000 as number | null,
    newsletterBroadcastsPerMonth: 4 as number | null,
    /** Video Script & Shot List — Pro feature. Creator sees the upsell card. */
    scriptsPerMonth: 0 as number | null,
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
    /** Newsletter: Pro-tier caps. 10k subscribers + unlimited broadcasts —
     *  even at heavy use (say 10 broadcasts × 10k = 100k emails/mo) the Resend
     *  cost is ~$40, still well under 25% of Pro's $199 MRR. The contact cap
     *  protects MVP from a creator suddenly importing a 50k list and tanking
     *  shared sender rep before deliverability quarantine catches it. */
    newsletterSubscribers: 10000 as number | null,
    newsletterBroadcastsPerMonth: null as number | null,
    /** Video Script & Shot List — 30 generations / calendar month. At
     *  ~5k Sonnet tokens per generation that's roughly $5/mo per
     *  fully-using creator — under 3% of Pro's $199 MRR. */
    scriptsPerMonth: 30 as number | null,
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
    /** Newsletter: admin uncapped — internal accounts, no shared-rep risk. */
    newsletterSubscribers: null as number | null,
    newsletterBroadcastsPerMonth: null as number | null,
    /** Video Script & Shot List — admin uncapped. */
    scriptsPerMonth: null as number | null,
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

/** Newsletter subscriber cap for the given tier. null = unlimited (Pro+).
 *  Used by /api/newsletter/subscribe to reject new sign-ups past the cap
 *  with an upgrade nudge instead of silently dropping them. */
export function allowedNewsletterSubscribers(tier: Tier): number | null {
  return TIERS[normalizeTier(tier)].newsletterSubscribers
}

/** Newsletter broadcast-send cap per billing month. null = unlimited. Used
 *  by /api/newsletter/send to gate the send button + render the upgrade
 *  banner once the creator hits the ceiling. */
export function allowedNewsletterBroadcasts(tier: Tier): number | null {
  return TIERS[normalizeTier(tier)].newsletterBroadcastsPerMonth
}

/** Next-tier upgrade hint for capped actions. Returns null when the
 *  user is already on Pro / Admin (no upward path). Used by routes to
 *  build a "Upgrade to Pro → 300 thumbnails / mo" call-to-action when
 *  a user hits a cap. */
export function nextTierFor(
  tier: Tier,
  cap: 'postsPerMonth' | 'collabsPerMonth' | 'thumbnailsPerMonth' | 'metadataGensPerMonth' | 'instagramAiThumbnailsPerMonth' | 'scriptsPerMonth',
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

/**
 * Video Script & Shot List monthly cap. Counts rows in `video_scripts` for
 * this user since the 1st of the current UTC month, against the tier's
 * `scriptsPerMonth`. Pro-only by design — Trial / Creator return `allowed:
 * false` with a "Pro feature" upsell so the /script page shows the gate
 * instead of the generator.
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
  const { data: ig } = await (supabase as any)
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
  const { count } = await (supabase as any)
    .from('video_scripts')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .gte('created_at', startISO)
  const used = count ?? 0

  // Admin — uncapped (cap === null).
  if (cap === null) return { allowed: true, tier, used, cap: null, resetLabel }

  // Tiers with cap === 0 (trial / creator) → upsell instead of usage block.
  if (cap === 0) {
    const next = nextTierFor(tier, 'scriptsPerMonth')
    return {
      allowed: false,
      reason: 'Video scripts are a Pro feature. Upgrade to start generating film-ready scripts in your voice.',
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
