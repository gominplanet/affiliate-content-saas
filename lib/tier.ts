export type Tier = 'free' | 'starter' | 'growth' | 'pro' | 'admin'

export const TIERS = {
  free:    {
    label: 'Free',
    price: 0,
    regularPrice: 0,
    postsPerMonth: null as number | null,
    lifetimeMax: 5 as number | null,
    sites: 1,
    socials: ['facebook', 'pinterest', 'threads'] as readonly string[],
    priorityQueue: false,
    prioritySupport: false,
  },
  starter: {
    label: 'Starter',
    price: 49,
    regularPrice: 99,
    postsPerMonth: 30,
    lifetimeMax: null as number | null,
    sites: 1,
    socials: ['facebook', 'pinterest', 'threads'] as readonly string[],
    priorityQueue: false,
    prioritySupport: false,
  },
  growth:  {
    label: 'Growth',
    price: 99,
    regularPrice: 199,
    postsPerMonth: 60,
    lifetimeMax: null as number | null,
    sites: 1,
    socials: ['facebook', 'pinterest', 'threads'] as readonly string[],
    priorityQueue: true,
    prioritySupport: false,
  },
  pro:     {
    label: 'Pro',
    price: 199,
    regularPrice: 299,
    postsPerMonth: 150,
    lifetimeMax: null as number | null,
    sites: 1,
    socials: ['facebook', 'pinterest', 'threads', 'linkedin'] as readonly string[],
    priorityQueue: true,
    prioritySupport: true,
  },
  admin:   {
    label: 'Admin',
    price: 0,
    regularPrice: 0,
    postsPerMonth: null as number | null,
    lifetimeMax: null as number | null,
    sites: 999,
    socials: ['facebook', 'pinterest', 'threads', 'linkedin'] as readonly string[],
    priorityQueue: true,
    prioritySupport: true,
  },
} as const

/** Whether a given tier can publish to a specific social platform. */
export function tierAllowsSocial(tier: Tier, social: 'facebook' | 'pinterest' | 'threads' | 'linkedin'): boolean {
  return TIERS[tier].socials.includes(social)
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

  // Free tier — 5 posts lifetime
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
