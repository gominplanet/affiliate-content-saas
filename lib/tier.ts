export type Tier = 'free' | 'starter' | 'growth' | 'pro' | 'admin'

export const TIERS = {
  free:    { label: 'Free',    price: 0,  videosPerMonth: null, videosPerDay: null, videosPerWeek: null, lifetimeMax: 5 },
  starter: { label: 'Starter', price: 19, videosPerMonth: 25,   videosPerDay: null, videosPerWeek: null, lifetimeMax: null },
  growth:  { label: 'Growth',  price: 39, videosPerMonth: 75,   videosPerDay: null, videosPerWeek: null, lifetimeMax: null },
  pro:     { label: 'Pro',     price: 79, videosPerMonth: 250,  videosPerDay: null, videosPerWeek: null, lifetimeMax: null },
  admin:   { label: 'Admin',   price: 0,  videosPerMonth: null, videosPerDay: null, videosPerWeek: null, lifetimeMax: null },
} as const

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

  if (limits.videosPerMonth !== null) {
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { count } = await (supabase as any)
      .from('blog_posts')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .gte('published_at', monthStart)

    if ((count ?? 0) >= limits.videosPerMonth) {
      return {
        allowed: false,
        reason: `You've reached your ${limits.videosPerMonth} posts/month limit on the ${limits.label} plan. Resets on the 1st.`,
        tier,
      }
    }
  }

  return { allowed: true }
}
