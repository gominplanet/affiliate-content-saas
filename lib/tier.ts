export type Tier = 'free' | 'starter' | 'growth' | 'pro' | 'admin'

export const TIERS = {
  free:    { label: 'Free',    price: 0,  videosPerDay: null, videosPerWeek: null, lifetimeMax: 5 },
  starter: { label: 'Starter', price: 25, videosPerDay: null, videosPerWeek: 4,   lifetimeMax: null },
  growth:  { label: 'Growth',  price: 40, videosPerDay: 1,    videosPerWeek: null, lifetimeMax: null },
  pro:     { label: 'Pro',     price: 95, videosPerDay: 5,    videosPerWeek: null, lifetimeMax: null },
  admin:   { label: 'Admin',   price: 0,  videosPerDay: null, videosPerWeek: null, lifetimeMax: null },
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

  if (limits.videosPerWeek !== null) {
    const weekStart = getWeekStart(now).toISOString()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { count } = await (supabase as any)
      .from('blog_posts')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .gte('published_at', weekStart)

    if ((count ?? 0) >= limits.videosPerWeek) {
      return {
        allowed: false,
        reason: `You've reached your ${limits.videosPerWeek} posts/week limit on the ${limits.label} plan.`,
        tier,
      }
    }
  } else if (limits.videosPerDay !== null) {
    const dayStart = new Date(now)
    dayStart.setHours(0, 0, 0, 0)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { count } = await (supabase as any)
      .from('blog_posts')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .gte('published_at', dayStart.toISOString())

    if ((count ?? 0) >= limits.videosPerDay) {
      return {
        allowed: false,
        reason: `You've reached your ${limits.videosPerDay} post${limits.videosPerDay > 1 ? 's' : ''}/day limit on the ${limits.label} plan.`,
        tier,
      }
    }
  }

  return { allowed: true }
}

function getWeekStart(date: Date): Date {
  const d = new Date(date)
  const day = d.getDay()
  const diff = d.getDate() - day + (day === 0 ? -6 : 1)
  d.setDate(diff)
  d.setHours(0, 0, 0, 0)
  return d
}
