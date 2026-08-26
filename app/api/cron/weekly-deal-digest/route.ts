/**
 * GET /api/cron/weekly-deal-digest
 *
 * Phase 2 of the Keepa content loop. For each opted-in Pro creator, publishes a
 * weekly "Top {niche} Deals" roundup blog post built from the best verified
 * deals in deal_radar_cache — hands-off, recurring, SEO-complete content.
 *
 * OPT-IN: integrations.notification_preferences->>'weekly_digest' = 'true'.
 * ROUND-ROBIN: least-recently-digested first (last_weekly_digest_at), a 6-day
 * cooldown so each user gets ~one/week, and a per-run batch cap so we stay under
 * the function timeout. Scheduled daily (vercel.json) — the cooldown enforces
 * the weekly cadence while spreading the AI/publish load across days.
 *
 * Auth: Vercel cron carries `Authorization: Bearer ${CRON_SECRET}`.
 */
import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getWordPressCredentials } from '@/lib/wordpress-sites'
import { createWordPressService } from '@/services/wordpress'
import { createAnthropicClient } from '@/lib/anthropic'
import { recordAnthropicUsage } from '@/lib/ai-usage'
import { applyPostFixes } from '@/lib/seo-fix'
import { checkSpendCeiling } from '@/lib/ai-spend'
import { pickDigestDeals, resolveAffiliateUrl, generateDigestContent, nicheLabelFrom, keywordSlug, type DigestDeal } from '@/lib/weekly-digest'
import { getLinkStyle } from '@/lib/link-cloak'
import { writeContentSchema } from '@/lib/content-schema'

export const runtime = 'nodejs'
export const maxDuration = 300

/** Users to publish for per run. Kept modest so one run stays under the timeout
 *  (each digest is several AI calls + a publish + the SEO pass). */
const BATCH = Math.max(1, Number(process.env.DIGEST_BATCH) || 5)
const COOLDOWN_DAYS = 6

const DEFAULT_DISCLOSURE = 'As an Amazon Associate I earn from qualifying purchases. This post contains affiliate links, and I may earn a commission at no extra cost to you.'
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

export async function GET(req: Request) {
  const authHeader = req.headers.get('authorization')
  if (!process.env.CRON_SECRET || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const admin = createAdminClient()
  const deadline = Date.now() + 270_000
  const cutoff = new Date(Date.now() - COOLDOWN_DAYS * 86_400_000).toISOString()

  // Opted-in Pro users, least-recently-digested first, respecting the cooldown.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: users } = await (admin as any)
    .from('integrations')
    .select('user_id,tier,amazon_associates_tag,geniuslink_api_key,geniuslink_api_secret,notification_preferences,last_weekly_digest_at')
    .in('tier', ['pro', 'admin'])
    .or(`last_weekly_digest_at.is.null,last_weekly_digest_at.lt.${cutoff}`)
    .order('last_weekly_digest_at', { ascending: true, nullsFirst: true })
    .limit(200)

  const optedIn = ((users ?? []) as UserRow[]).filter((u) => {
    const p = u.notification_preferences
    return p && typeof p === 'object' && (p as Record<string, unknown>).weekly_digest === true
  })

  const client = createAnthropicClient()
  let published = 0, skipped = 0
  const results: Array<{ user: string; status: string }> = []

  for (const u of optedIn.slice(0, BATCH)) {
    if (Date.now() > deadline) break
    // Claim this user up front so a mid-run failure doesn't hammer them next run.
    const stamp = async () => { await (admin as any).from('integrations').update({ last_weekly_digest_at: new Date().toISOString() }).eq('user_id', u.user_id) }
    try {
      const site = await getWordPressCredentials(admin, u.user_id)
      if (!site) { skipped++; results.push({ user: u.user_id, status: 'no_wordpress' }); await stamp(); continue }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: brand } = await (admin as any)
        .from('brand_profiles').select('name,niches,affiliate_disclaimer').eq('user_id', u.user_id).maybeSingle()
      const niches: string[] = Array.isArray(brand?.niches) ? brand.niches : []

      const rows = await pickDigestDeals(admin, niches, 5)
      if (rows.length < 3) { skipped++; results.push({ user: u.user_id, status: 'too_few_deals' }); await stamp(); continue }

      // Per-user AI-spend ceiling — a cron must honor the same dollar cap the
      // interactive routes do, or an over-ceiling account keeps getting billed
      // for digests. Stamp so we don't re-select them daily for the rest of the
      // month (the ceiling resets on the 1st).
      const spend = await checkSpendCeiling(u.user_id, u.tier)
      if (!spend.allowed) { skipped++; results.push({ user: u.user_id, status: 'over_spend_ceiling' }); await stamp(); continue }

      // Claim this user NOW, before the AI generation + WordPress publish. If the
      // function is killed mid-publish (the 270s deadline or a crash), the post
      // may already be live; without an up-front claim the next daily run would
      // re-select the same user and publish a SECOND identical digest + re-bill.
      // A weekly digest missed on a rare mid-run failure is the acceptable cost.
      await stamp()

      const tag = (u.amazon_associates_tag || '').trim() || null
      // Resolve this user's link style ONCE per digest, then reuse for each deal.
      const linkCfg = await getLinkStyle(admin, u.user_id)
      // Resolve the (few) affiliate URLs concurrently — they're independent
      // Geniuslink calls; a serial loop stacked their latency. Order preserved.
      const deals: DigestDeal[] = await Promise.all(
        rows.map(async (r) => ({
          ...r,
          affiliateUrl: await resolveAffiliateUrl(r.asin, r.title, tag, u.geniuslink_api_key, u.geniuslink_api_secret, u.user_id, linkCfg),
        })),
      )

      const nicheLabel = nicheLabelFrom(niches)
      const monthYear = new Date().toLocaleString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' })
      const { title, html, excerpt, theme } = await generateDigestContent({
        client, deals, reviewerName: (brand?.name as string) || 'the team', nicheLabel, monthYear,
        recordUsage: (msg) => recordAnthropicUsage(msg, { userId: u.user_id, tier: u.tier, feature: 'weekly_digest', model: 'claude-haiku-4-5-20251001' }),
      })
      const seoKeyword = theme || nicheLabel

      // FTC disclosure, always present (applyPostFixes will detect + skip it).
      const disc = ((brand?.affiliate_disclaimer as string | null) || '').trim() || DEFAULT_DISCLOSURE
      const body = `<p class="mvp-affiliate-disclosure" style="font-size:13px;color:#6b6b70;font-style:italic;margin:0 0 1.25em"><em>${esc(disc)}</em></p>\n\n${html}`

      const wpService = createWordPressService(site.wordpress_url, site.wordpress_username, site.wordpress_app_password, site.wordpress_api_token || undefined)
      // File under a real "Deals" category (create if missing), never "Blog".
      let categoryIds: number[] = []
      try { const id = await wpService.createCategory('Deals'); if (id) categoryIds = [id] } catch { /* leave as-is */ }
      // Featured thumbnail — lead deal's product image (roundup spans products).
      let featuredMediaId: number | null = null
      const heroImage = deals.find((d) => d.image_url)?.image_url
      if (heroImage) {
        try {
          const media = await wpService.uploadImageFromUrl(heroImage, `${(theme || 'deals').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'deals'}-weekly.jpg`)
          featuredMediaId = (media?.id as number | undefined) ?? null
        } catch (err) { console.warn('[weekly-digest] featured image upload failed:', err instanceof Error ? err.message : err) }
      }
      const slug = keywordSlug(title, theme)
      const wpPost = await wpService.createPost({
        title, slug, content: body, excerpt,
        status: 'publish', comment_status: 'closed', ping_status: 'closed',
        ...(categoryIds.length ? { categories: categoryIds } : {}),
        ...(featuredMediaId ? { featured_media: featuredMediaId } : {}),
      })

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: saved } = await (admin as any).from('blog_posts').insert({
        user_id: u.user_id, video_id: null, title, slug, content: body, excerpt: null,
        wordpress_post_id: wpPost.id, wordpress_url: wpPost.link, wordpress_site_id: site.site_id,
        status: 'published', post_type: 'deal', seo_keyword: seoKeyword,
        deal_meta: { kind: 'roundup', asins: deals.map((d) => d.asin) },
        published_at: new Date().toISOString(),
      }).select('id').single()

      // SEO polish (FAQ, internal links, keyword, title trim; disclosure no-ops).
      if (saved?.id) {
        try {
          await applyPostFixes({
            supabase: admin, userId: u.user_id, wpService,
            wpBase: site.wordpress_url.replace(/\/+$/, ''), tier: u.tier,
            post: { id: saved.id as string, title, slug, content: body, seo_keyword: seoKeyword, post_type: 'deal', wordpress_post_id: wpPost.id },
            fixes: 'all',
          })
        } catch (err) { console.warn('[weekly-digest] SEO fix failed (post live):', err instanceof Error ? err.message : err) }
      }

      await writeContentSchema(admin, wpService, {
        userId: u.user_id,
        siteUrl: site.wordpress_url,
        wpPostId: wpPost.id,
        pageUrl: wpPost.link,
        title,
        description: excerpt,
        html: body,
        imageUrl: heroImage || null,
        pageType: 'BlogPosting',
        category: 'Deals',
      })

      published++
      results.push({ user: u.user_id, status: 'published' })
    } catch (err) {
      // Already claimed up front, so a failure here just means this cycle is lost
      // for the user (no duplicate, no re-bill); they're picked up next week.
      console.error('[weekly-digest] failed for', u.user_id, err instanceof Error ? err.message : err)
      results.push({ user: u.user_id, status: 'error' })
    }
  }

  return NextResponse.json({ ok: true, optedIn: optedIn.length, published, skipped, results })
}

interface UserRow {
  user_id: string
  tier: string | null
  amazon_associates_tag: string | null
  geniuslink_api_key: string | null
  geniuslink_api_secret: string | null
  notification_preferences: unknown
  last_weekly_digest_at: string | null
}
