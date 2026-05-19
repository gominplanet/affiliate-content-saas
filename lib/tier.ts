export type Tier = 'free' | 'starter' | 'growth' | 'pro' | 'admin'

export type Social = 'facebook' | 'threads' | 'linkedin' | 'pinterest' | 'twitter' | 'bluesky' | 'telegram' | 'instagram'

export const TIERS = {
  free:    {
    label: 'Free',
    price: 0,
    regularPrice: 0,
    postsPerMonth: null as number | null,
    lifetimeMax: 15 as number | null,
    /** Collaboration pitch emails / month. 0 = not on this plan (Pro+
     *  only), null = unlimited. Single source of truth for the cap. */
    collabsPerMonth: 0 as number | null,
    /** Base posts the tier markets (used for the "60 + 20 bonus" framing). */
    basePosts: 15,
    bonusPosts: 0,
    sites: 1,
    socials: ['facebook'] as readonly Social[],
    priorityQueue: false,
    prioritySupport: false,
    publishAll: false,
  },
  starter: {
    label: 'Starter',
    price: 49,
    regularPrice: 99,
    postsPerMonth: 30,
    lifetimeMax: null as number | null,
    collabsPerMonth: 0 as number | null,
    basePosts: 30,
    bonusPosts: 0,
    sites: 1,
    socials: ['facebook', 'pinterest'] as readonly Social[],
    priorityQueue: false,
    prioritySupport: false,
    publishAll: false,
  },
  growth:  {
    label: 'Growth',
    price: 99,
    regularPrice: 199,
    postsPerMonth: 80,
    lifetimeMax: null as number | null,
    collabsPerMonth: 0 as number | null,
    basePosts: 60,
    bonusPosts: 20,
    sites: 1,
    socials: ['facebook', 'threads', 'linkedin', 'pinterest', 'bluesky'] as readonly Social[],
    priorityQueue: true,
    prioritySupport: false,
    publishAll: false,
  },
  pro:     {
    label: 'Pro',
    price: 199,
    regularPrice: 499,
    postsPerMonth: 150,
    lifetimeMax: null as number | null,
    collabsPerMonth: 100 as number | null,
    basePosts: 90,
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
    basePosts: 0,
    bonusPosts: 0,
    sites: 999,
    socials: ['facebook', 'threads', 'linkedin', 'pinterest', 'twitter', 'bluesky', 'telegram', 'instagram'] as readonly Social[],
    priorityQueue: true,
    prioritySupport: true,
    publishAll: true,
  },
} as const

/** Whether a given tier can publish to a specific social platform. */
export function tierAllowsSocial(tier: Tier, social: Social): boolean {
  return TIERS[tier].socials.includes(social)
}

/** Whether a given tier can use the one-click Publish All flow. */
export function tierAllowsPublishAll(tier: Tier): boolean {
  return TIERS[tier].publishAll
}

// Returns { allowed: true } or { allowed: false, reason, tier }
export async function checkUsageLimit(
  supabase: Awaited<ReturnType<typeof import('@/lib/supabase/server').createServerClient>>,
  userId: string,
): Promise<{ allowed: true } | { allowed: false; reason: string; tier: Tier }> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: ig } = await (supabase as any)
    .from('integrations')
    .select('tier')
    .eq('user_id', userId)
    .single()

  const tier = (ig?.tier as Tier) ?? 'free'
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
      return {
        allowed: false,
        reason: `You've used all ${limits.lifetimeMax} free posts. Upgrade to keep publishing.`,
        tier,
      }
    }
    return { allowed: true }
  }

  const now = new Date()

  if (limits.postsPerMonth !== null) {
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { count } = await (supabase as any)
      .from('blog_posts')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .gte('published_at', monthStart)

    if ((count ?? 0) >= limits.postsPerMonth) {
      return {
        allowed: false,
        reason: `You've reached your ${limits.postsPerMonth} posts/month limit on the ${limits.label} plan. Resets on the 1st.`,
        tier,
      }
    }
  }

  return { allowed: true }
}
