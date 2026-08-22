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
 *   • Everyone else → "Generations" (NEW content pieces = blog_posts rows, the
 *     one thing RPC 131 counts) and, for Pro, Shorts + X.
 *   • Every tier also shows the enforced shared caps that apply to it: Deals,
 *     Collabs, Ask Me, Photobooth, YT metadata, Scripts, IG AI images,
 *     Newsletters, and Scheduled (cascade-only) — each counted against the SAME
 *     window its gate uses (billing cycle for ai_usage caps; calendar month for
 *     scripts / newsletters / cascade).
 *
 * Thumbnails/metadata are NOT summed into Generations (that over-reported and
 * hid metadata's own cap). Only finite caps (> 0) are returned; unlimited/zero
 * buckets are omitted so the meter stays clean. On any DB hiccup we return an
 * empty bucket list — the meter hides rather than showing a wrong number.
 */
import { NextResponse } from 'next/server'
import {
  TIERS, billingWindow, effectivePostCap, allowedNewsletterBroadcasts, normalizeTier, type Tier,
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
    .select('tier,subscription_period_start,subscription_period_end,legacy_creator_newsletter')
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
  // Some caps (scripts, newsletter broadcasts, cascade-only schedules) reset on
  // the CALENDAR month, independent of the billing cycle — count those against
  // it so each meter matches the exact gate that enforces it.
  const now = new Date()
  const calStartISO = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString()

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
  // Count rows since an EXPLICIT start (for the calendar-month caps above),
  // optionally filtered to a set of statuses (newsletter broadcasts).
  const countSince = async (table: string, dateCol: string, sinceISO: string, statusIn?: string[]): Promise<number> => {
    try {
      let q = sb.from(table).select('id', { count: 'exact', head: true }).eq('user_id', user.id).gte(dateCol, sinceISO)
      if (statusIn) q = q.in('status', statusIn)
      const { count } = await q
      return count ?? 0
    } catch { return 0 }
  }
  // Cascade-only schedules are capped by DISTINCT posts scheduled this calendar
  // month (kind='social', parent_id IS NULL) — count exactly what the gate does.
  const countCascade = async (): Promise<number> => {
    try {
      const { data } = await sb.from('scheduled_posts')
        .select('blog_post_id').eq('user_id', user.id).eq('kind', 'social').is('parent_id', null)
        .gte('created_at', calStartISO).limit(2000)
      if (!Array.isArray(data)) return 0
      return new Set((data as { blog_post_id?: string }[]).map(r => r.blog_post_id ?? '').filter(Boolean)).size
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
      // Generations = NEW content pieces only (blog_posts rows in the window),
      // matching the gate (RPC 131). Thumbnails + metadata are intentionally NOT
      // summed in here: thumbnails are $-gated free enrichment off the Amazon
      // tier (no count cap), and metadata has its OWN cap, shown as its own
      // bucket below. Before, the meter summed all three and over-reported —
      // a user could see "20/20" while the real blog gate still had room.
      const genLimit = lifetime ? plan.lifetimeMax : effectivePostCap(tier, startISO)
      const blog = await countRows('blog_posts', 'published_at')
      push('generations', lifetime ? 'Generations (trial)' : 'Generations', blog, genLimit)
      // Thumbnails are their OWN enforced cap on every tier (shared by co-pilot
      // + blog heroes, both counted here) — show it so users see where they are.
      const thumb = await countFeatures(THUMB_FEATURES)
      push('thumbnails', 'Thumbnails', thumb, plan.thumbnailsPerMonth)
      if (tier === 'pro') {
        const [shorts, x] = await Promise.all([countFeatures(['shorts_render']), countFeatures(['x_post'])])
        push('shorts', 'Shorts', shorts, SHORTS_MONTHLY_CAP)
        push('x', 'X posts', x, X_MONTHLY_CAP)
      }
      // Amazon-style designed social graphics — now finite + metered on Studio
      // and Pro too, so show their bars (Amazon renders these in the branch
      // above). push() skips any tier where the cap is 0/null.
      const [pin, igCount, fb] = await Promise.all([
        countFeatures(['amazon_pin']), countFeatures(['amazon_ig']), countFeatures(['amazon_fb']),
      ])
      push('pins', 'Pins', pin, plan.pinsPerMonth)
      push('instagram', 'Instagram', igCount, plan.igPostsPerMonth)
      push('facebook', 'Facebook', fb, plan.facebookPostsPerMonth)
    }

    // ── Shared extra caps (shown on any tier where the cap is finite) ──
    // Every one of these is an ENFORCED per-feature cap; surfacing them here is
    // what lets a user see where they stand before they hit a wall.
    const [asst, photo, collabs, deals, meta, igAi, scripts, broadcasts, cascade, articles] = await Promise.all([
      countFeatures(['assistant_message']),                                   // billing window (checkUsageCap)
      countFeatures(['photobooth_image']),                                    // billing window
      countRows('collaborations', 'created_at'),                              // billing window
      countRows('blog_posts', 'published_at', { col: 'post_type', val: 'deal' }),
      countFeatures([META_FEATURE]),                                          // billing window (own cap)
      countFeatures(['ig_ai_thumbnail_image']),                               // billing window
      countSince('video_scripts', 'created_at', calStartISO),                 // calendar month
      countSince('newsletter_broadcasts', 'created_at', calStartISO, ['sending', 'sent', 'scheduled', 'ab_testing']),
      countCascade(),                                                         // calendar month, distinct posts
      countRows('blog_posts', 'created_at', { col: 'post_type', val: 'article' }), // own cap (billing window)
    ])
    // Deals: only tiers with NO generations pool (Amazon) gate on their own
    // dealsPerMonth cap — for everyone else a deal is a content piece counted in
    // Generations above, so a separate "Deals" cap would misrepresent the gate.
    if (TIERS[tier]?.postsPerMonth === 0 || isAdminPreview) {
      push('deals', 'Deals', preview(deals, 63), refPlan.dealsPerMonth)
    }
    push('collabs', 'Collabs', preview(collabs, 41), refPlan.collabsPerMonth)
    push('assistant', 'Ask Me', preview(asst, 372), refPlan.assistantMessagesPerMonth)
    push('photobooth', 'Photobooth', preview(photo, 4), refPlan.photoboothPerMonth)
    // Metadata has its own enforced cap (was previously hidden inside the
    // Generations sum, which both over-reported generations AND hid this cap).
    push('metadata', 'YT metadata', preview(meta, 60), refPlan.metadataGensPerMonth)
    push('scripts', 'Scripts', preview(scripts, 8), refPlan.scriptsPerMonth)
    push('igai', 'IG AI images', preview(igAi, 22), refPlan.instagramAiThumbnailsPerMonth)
    // Newsletter cap can be raised for legacy Creator accounts — use the same
    // helper the send gate uses so the meter matches the enforced number.
    push('newsletter', 'Newsletters', preview(broadcasts, 2),
      allowedNewsletterBroadcasts(tier, { legacyCreatorNewsletter: !!(ig as { legacy_creator_newsletter?: boolean } | null)?.legacy_creator_newsletter }))
    push('cascade', 'Scheduled', preview(cascade, 12), refPlan.cascadeOnlySchedulesPerMonth)
    push('articles', 'Articles', preview(articles, 3), refPlan.articlesPerMonth)
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
