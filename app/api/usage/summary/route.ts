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
  /** null = unlimited on this plan (show the running count, no bar). */
  limit: number | null
  remaining: number | null
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

  // Count ai_usage rows for a feature set within the window (or lifetime). Each
  // count is isolated — a failure returns 0 rather than breaking the whole meter.
  const countFeatures = async (features: string[]): Promise<number> => {
    try {
      let q = sb.from('ai_usage').select('id', { count: 'exact', head: true })
        .eq('user_id', user.id).in('feature', features)
      if (windowStart) q = q.gte('created_at', windowStart)
      const { count } = await q
      return count ?? 0
    } catch { return 0 }
  }
  // Count rows in an arbitrary table (collaborations, deal posts) in the window.
  const countRows = async (table: string, dateCol: string, extra?: { col: string; val: string }): Promise<number> => {
    try {
      let q = sb.from(table).select('id', { count: 'exact', head: true }).eq('user_id', user.id)
      if (extra) q = q.eq(extra.col, extra.val)
      if (windowStart) q = q.gte(dateCol, windowStart)
      const { count } = await q
      return count ?? 0
    } catch { return 0 }
  }

  const buckets: Bucket[] = []
  const push = (key: string, label: string, used: number, limit: number | null | undefined) => {
    if (typeof limit !== 'number' || limit <= 0) return // skip unlimited / zero
    buckets.push({ key, label, used, limit, remaining: Math.max(0, limit - used) })
  }

  // Admin is unlimited, so nothing is finite — render it against the Amazon
  // tier's caps as a REFERENCE with a varied sample so the founder sees the full
  // visual. Real usage still wins if higher; paid tiers always use real counts.
  const isAdminPreview = tier === 'admin'
  const refPlan = isAdminPreview ? TIERS.amazon : plan
  const preview = (real: number, sample: number) => isAdminPreview ? Math.max(real, sample) : real

  try {
    // ── Primary buckets (tier-shaped) ──
    if (tier === 'amazon' || tier === 'admin') {
      const [thumb, pin, igCount, fb] = await Promise.all([
        countFeatures(THUMB_FEATURES),
        countFeatures(['amazon_pin']),
        countFeatures(['amazon_ig']),
        countFeatures(['amazon_fb']),
      ])
      push('thumbnails', 'Thumbnails', preview(thumb, 128), refPlan.thumbnailsPerMonth)
      push('pins', 'Pins', preview(pin, 271), refPlan.pinsPerMonth)
      push('instagram', 'Instagram', preview(igCount, 84), refPlan.igPostsPerMonth)
      push('facebook', 'Facebook', preview(fb, 12), refPlan.facebookPostsPerMonth)
    } else {
      // Shared Generations bundle = blog posts + thumbnails + metadata.
      const genLimit = lifetime ? plan.lifetimeMax : effectivePostCap(tier, startISO)
      const [blog, thumb, meta] = await Promise.all([
        countRows('blog_posts', 'published_at'),
        countFeatures(THUMB_FEATURES),
        countFeatures([META_FEATURE]),
      ])
      push('generations', lifetime ? 'Generations (trial)' : 'Generations', blog + thumb + meta, genLimit)
      if (tier === 'pro') {
        const [shorts, x] = await Promise.all([countFeatures(['shorts_render']), countFeatures(['x_post'])])
        push('shorts', 'Shorts', shorts, SHORTS_MONTHLY_CAP)
        push('x', 'X posts', x, X_MONTHLY_CAP)
      }
    }

    // ── Shared extra caps (shown on any tier where the cap is finite) ──
    const [asst, photo, collabs, deals] = await Promise.all([
      countFeatures(['assistant_message']),
      countFeatures(['photobooth_image']),
      countRows('collaborations', 'created_at'),
      countRows('blog_posts', 'published_at', { col: 'post_type', val: 'deal' }),
    ])
    push('deals', 'Deals', preview(deals, 63), refPlan.dealsPerMonth)
    push('collabs', 'Collabs', preview(collabs, 41), refPlan.collabsPerMonth)
    push('assistant', 'Ask Me', preview(asst, 372), refPlan.assistantMessagesPerMonth)
    push('photobooth', 'Photobooth', preview(photo, 4), refPlan.photoboothPerMonth)
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
