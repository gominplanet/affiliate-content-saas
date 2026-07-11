/**
 * GET /api/usage/generations — read-only monthly consumption for the dashboard
 * gauge. Mirrors the ENFORCED quota (try_consume_generation_quota, migration
 * 101): the "Generations" bundle = blog posts + YouTube thumbnails + YouTube
 * metadata, counted within the current billing window (or lifetime for trial).
 * This NEVER consumes quota — it only reads the same rows the RPC sums, so the
 * gauge and the actual cap can't disagree.
 */
import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { TIERS, billingWindow, effectivePostCap, normalizeTier, type Tier } from '@/lib/tier'

export const dynamic = 'force-dynamic'

// Keep in lockstep with try_consume_generation_quota (migration 101) so the
// gauge reflects exactly what the cap enforces.
const THUMB_FEATURES = [
  'yt_thumb_gptimage',
  'yt_thumb_kontext_image',
  'yt_thumb_flux_image',
  'yt_thumb_flux_lora_image',
  'yt_thumb_nanobanana_image',
  'yt_thumb_ideogram_image',
]
const META_FEATURE = 'yt_meta_title_strategist'

export async function GET() {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any
  const { data: ig } = await sb
    .from('integrations')
    .select('tier,subscription_period_start,subscription_period_end')
    .eq('user_id', user.id)
    .maybeSingle()

  const tier = normalizeTier(ig?.tier)
  const plan = TIERS[tier] ?? TIERS.trial
  const lifetime = plan.lifetimeMax !== null // trial = a one-time lifetime allowance

  const { startISO, resetLabel } = billingWindow({
    periodStart: (ig?.subscription_period_start as string | null) ?? null,
    periodEnd: (ig?.subscription_period_end as string | null) ?? null,
  })
  // Trial → lifetime allowance (count everything). Paid → grandfather-aware
  // monthly cap counted within the billing window. Admin → effectivePostCap null.
  const limit = lifetime ? plan.lifetimeMax : effectivePostCap(tier, startISO)
  const windowStart = lifetime ? null : startISO

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const applyWindow = (q: any, col: string) => (windowStart ? q.gte(col, windowStart) : q)

  let used = 0
  try {
    const [blog, thumb, meta] = await Promise.all([
      applyWindow(sb.from('blog_posts').select('id', { count: 'exact', head: true }).eq('user_id', user.id), 'published_at'),
      applyWindow(sb.from('ai_usage').select('id', { count: 'exact', head: true }).eq('user_id', user.id).in('feature', THUMB_FEATURES), 'created_at'),
      applyWindow(sb.from('ai_usage').select('id', { count: 'exact', head: true }).eq('user_id', user.id).eq('feature', META_FEATURE), 'created_at'),
    ])
    used = (blog.count ?? 0) + (thumb.count ?? 0) + (meta.count ?? 0)
  } catch {
    // Count read failed → neutral "unlimited-looking" payload so the gauge hides
    // rather than showing a wrong number.
    return NextResponse.json({ tier, used: 0, limit: null, remaining: null, unlimited: true, resetLabel: null, lifetime })
  }

  const remaining = limit === null ? null : Math.max(0, limit - used)
  return NextResponse.json({
    tier,
    used,
    limit,
    remaining,
    unlimited: limit === null,
    resetLabel: lifetime ? null : resetLabel,
    lifetime,
  })
}
