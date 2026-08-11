/**
 * GET /api/usage/summary — every hard monthly limit that applies to the signed-in
 * user's tier, with how much is used, so the topbar meter can show it on every
 * page. Read-only: counts the SAME ai_usage / blog_posts rows the caps enforce
 * (checkUsageCap, try_consume_generation_quota, the per-format caps in
 * generate-thumbnail), so the meter and the actual gate can never disagree.
 *
 * Buckets are tier-shaped:
 *   • Amazon tier → the four Art Director format caps (Thumbnails, Pins,
 *     Instagram, Facebook) — each its own bucket, exactly what the plan sells.
 *   • Everyone else → the shared "Generations" allowance (blog + thumbnails +
 *     metadata) and, for Pro, Shorts + X, which have their own separate caps.
 *
 * Only finite caps (> 0) are returned. Unlimited/zero buckets are omitted so the
 * meter stays clean. On any DB hiccup we return an empty bucket list — the meter
 * hides rather than showing a wrong number.
 */
import { NextResponse } from 'next/server'
import {
  TIERS, billingWindow, effectivePostCap, normalizeTier, type Tier,
} from '@/lib/tier'
import { SHORTS_MONTHLY_CAP, X_MONTHLY_CAP } from '@/lib/usage-cap'
import { createServerClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

// Feature names, kept in lockstep with the enforcing paths.
const THUMB_FEATURES = [
  'yt_thumb_gptimage', 'yt_thumb_kontext_image', 'yt_thumb_flux_image',
  'yt_thumb_flux_lora_image', 'yt_thumb_nanobanana_image', 'yt_thumb_ideogram_image',
  'yt_thumb_graphic',
]
const META_FEATURE = 'yt_meta_title_strategist'

interface Bucket {
  key: string
  label: string
  used: number
  limit: number
  remaining: number
}

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

  const tier: Tier = normalizeTier(ig?.tier)
  const plan = TIERS[tier] ?? TIERS.trial
  const lifetime = plan.lifetimeMax !== null // trial = one-time lifetime allowance

  const { startISO, resetLabel } = billingWindow({
    periodStart: (ig?.subscription_period_start as string | null) ?? null,
    periodEnd: (ig?.subscription_period_end as string | null) ?? null,
  })
  const windowStart = lifetime ? null : startISO

  // Count ai_usage rows for a feature set within the window (or lifetime).
  const countFeatures = async (features: string[]): Promise<number> => {
    let q = sb.from('ai_usage').select('id', { count: 'exact', head: true })
      .eq('user_id', user.id).in('feature', features)
    if (windowStart) q = q.gte('created_at', windowStart)
    const { count } = await q
    return count ?? 0
  }

  const buckets: Bucket[] = []
  const push = (key: string, label: string, used: number, limit: number | null | undefined) => {
    if (typeof limit !== 'number' || limit <= 0) return // skip unlimited / zero
    buckets.push({ key, label, used, limit, remaining: Math.max(0, limit - used) })
  }

  try {
    if (tier === 'amazon') {
      // The four Art Director format caps — each counted on its own feature.
      const [thumb, pin, igCount, fb] = await Promise.all([
        countFeatures(THUMB_FEATURES),
        countFeatures(['amazon_pin']),
        countFeatures(['amazon_ig']),
        countFeatures(['amazon_fb']),
      ])
      push('thumbnails', 'Thumbnails', thumb, plan.thumbnailsPerMonth)
      push('pins', 'Pins', pin, plan.pinsPerMonth)
      push('instagram', 'Instagram', igCount, plan.igPostsPerMonth)
      push('facebook', 'Facebook', fb, plan.facebookPostsPerMonth)
    } else {
      // Shared Generations bundle = blog posts + thumbnails + metadata, the same
      // three sources try_consume_generation_quota sums.
      const genLimit = lifetime ? plan.lifetimeMax : effectivePostCap(tier, startISO)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const applyWindow = (q: any, col: string) => (windowStart ? q.gte(col, windowStart) : q)
      const [blog, thumb, meta] = await Promise.all([
        applyWindow(sb.from('blog_posts').select('id', { count: 'exact', head: true }).eq('user_id', user.id), 'published_at'),
        applyWindow(sb.from('ai_usage').select('id', { count: 'exact', head: true }).eq('user_id', user.id).in('feature', THUMB_FEATURES), 'created_at'),
        applyWindow(sb.from('ai_usage').select('id', { count: 'exact', head: true }).eq('user_id', user.id).eq('feature', META_FEATURE), 'created_at'),
      ])
      const genUsed = (blog.count ?? 0) + (thumb.count ?? 0) + (meta.count ?? 0)
      push('generations', lifetime ? 'Generations (trial)' : 'Generations', genUsed, genLimit)

      // Pro-only separate caps.
      if (tier === 'pro') {
        const [shorts, x] = await Promise.all([
          countFeatures(['shorts_render']),
          countFeatures(['x_post']),
        ])
        push('shorts', 'Shorts', shorts, SHORTS_MONTHLY_CAP)
        push('x', 'X posts', x, X_MONTHLY_CAP)
      }
    }
  } catch {
    return NextResponse.json({ tier, buckets: [], resetLabel: null, lifetime })
  }

  return NextResponse.json({
    tier,
    buckets,
    resetLabel: lifetime ? null : resetLabel,
    lifetime,
  })
}
