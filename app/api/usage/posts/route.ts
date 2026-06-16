/**
 * GET /api/usage/posts — the signed-in user's post allowance: how many they've
 * used this period (or lifetime, for the free trial) and how many remain.
 *
 * Powers the always-visible "N posts left" sidebar chip. Mirrors the exact
 * computation the dashboard does inline (TIERS + billingWindow), so the two
 * never disagree. Trial = a one-time lifetime allowance (count ALL posts);
 * paid = per billing period (count since the period start).
 */
import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { TIERS, billingWindow, type Tier } from '@/lib/tier'

export const dynamic = 'force-dynamic'

export async function GET() {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any
  const { data: integration } = await sb
    .from('integrations')
    .select('tier,subscription_period_start,subscription_period_end')
    .eq('user_id', user.id)
    .maybeSingle()

  const tier = ((integration?.tier as Tier) ?? 'trial')
  const plan = TIERS[tier] ?? TIERS.trial
  const lifetime = plan.lifetimeMax !== null
  const limit = lifetime ? plan.lifetimeMax : plan.postsPerMonth

  let used = 0
  let resetLabel: string | null = null
  try {
    if (lifetime) {
      const { count } = await sb.from('blog_posts')
        .select('id', { count: 'estimated', head: true }).eq('user_id', user.id)
      used = count ?? 0
    } else {
      const { startISO, resetLabel: rl } = billingWindow({
        periodStart: (integration?.subscription_period_start as string | null) ?? null,
        periodEnd: (integration?.subscription_period_end as string | null) ?? null,
      })
      resetLabel = rl
      const { count } = await sb.from('blog_posts')
        .select('id', { count: 'estimated', head: true })
        .eq('user_id', user.id).gte('published_at', startISO)
      used = count ?? 0
    }
  } catch {
    // Count read failed — return a neutral "unlimited-looking" payload so the
    // chip simply hides rather than showing a wrong number.
    return NextResponse.json({ tier, used: 0, limit: null, remaining: null, lifetime, unlimited: true, resetLabel: null })
  }

  const remaining = limit === null ? null : Math.max(0, limit - used)
  return NextResponse.json({ tier, used, limit, remaining, lifetime, unlimited: limit === null, resetLabel })
}
