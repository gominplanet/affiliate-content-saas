/**
 * POST /api/walmart/roundup  { items: [{ itemId, name, image?, url?, price?, oldPrice?, discountPct? }] }
 *
 * Turn a hand-picked set of Walmart offers into ONE curated roundup blog post on
 * the creator's WordPress. The Walmart twin of /api/deal-radar/roundup: same
 * digest engine (retailer = "Walmart"), each product wrapped in a minted +
 * Geniuslink-cloaked commissionable Walmart link. Paid + PartnerBoost gated.
 */
import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { normalizeTier, type Tier } from '@/lib/tier'
import { canUseDealRadar } from '@/lib/feature-access'
import { createWordPressService } from '@/services/wordpress'
import { getWordPressCredentials } from '@/lib/wordpress-sites'
import { createAnthropicClient } from '@/lib/anthropic'
import { recordAnthropicUsage } from '@/lib/ai-usage'
import { applyPostFixes } from '@/lib/seo-fix'
import { generateDigestContent, nicheLabelFrom, keywordSlug, type DigestDeal } from '@/lib/weekly-digest'
import { getWalmartProductLinks } from '@/services/partnerboost'
import { createGeniuslinkService } from '@/services/geniuslink'
import { getExternalKey } from '@/lib/external-keys'
import { toUserMessage } from '@/lib/friendly-error'
import { spendGate } from '@/lib/ai-spend'

export const runtime = 'nodejs'
export const maxDuration = 120

const DEFAULT_DISCLOSURE = 'This post contains affiliate links, and I may earn a commission at no extra cost to you.'
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const dollarsToCents = (v: unknown): number | null => {
  if (v == null || v === '') return null
  const n = Number(String(v).replace(/[^0-9.]/g, ''))
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : null
}

interface RoundupItem { itemId?: string; name?: string; image?: string | null; url?: string; price?: string | null; oldPrice?: string | null; discountPct?: number | null }

export async function POST(request: Request) {
  try {
    const supabase = await createServerClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = supabase as any

    const { data: intRow } = await sb.from('integrations')
      .select('tier,geniuslink_api_key,geniuslink_api_secret')
      .eq('user_id', user.id).maybeSingle()
    const tier = normalizeTier(intRow?.tier) as Tier
    if (!canUseDealRadar(tier)) {
      return NextResponse.json({ error: 'Deal Radar posting is available on paid plans.' }, { status: 403 })
    }

    const pbToken = await getExternalKey(supabase, user.id, 'partnerboost')
    if (!pbToken) return NextResponse.json({ error: 'Connect your PartnerBoost API key in External Integrations.' }, { status: 400 })

    const body = await request.json().catch(() => ({})) as { items?: unknown }
    const raw = (Array.isArray(body.items) ? body.items : []) as RoundupItem[]
    const items = raw
      .filter((it) => it && (it.itemId || '').trim() && (it.name || '').trim())
      .filter((it, i, arr) => arr.findIndex((x) => x.itemId === it.itemId) === i)
      .slice(0, 12)
    if (items.length < 2) return NextResponse.json({ error: 'Pick at least 2 deals for a roundup.' }, { status: 400 })

    const site = await getWordPressCredentials(supabase, user.id)
    if (!site) return NextResponse.json({ error: 'Connect your WordPress site first (Connect Socials / WordPress).' }, { status: 400 })

    const { data: brand } = await sb.from('brand_profiles').select('name,niches,affiliate_disclaimer').eq('user_id', user.id).maybeSingle()
    const niches: string[] = Array.isArray(brand?.niches) ? brand.niches : []

    // Mint all tracking links in one call, then cloak each via Geniuslink when
    // connected (best-effort — falls back to the minted link, then bare URL).
    const itemIds = items.map((it) => String(it.itemId).trim())
    let minted: Record<string, string> = {}
    try { minted = await getWalmartProductLinks(pbToken, itemIds) } catch { /* bare fallback below */ }
    const gKey = (intRow?.geniuslink_api_key || '').trim()
    const gSecret = (intRow?.geniuslink_api_secret || '').trim()
    const genius = gKey && gSecret ? createGeniuslinkService(gKey, gSecret) : null

    const deals: DigestDeal[] = await Promise.all(items.map(async (it): Promise<DigestDeal> => {
      const id = String(it.itemId).trim()
      let affiliateUrl = minted[id] || (it.url || '').trim() || `https://www.walmart.com/ip/${id}`
      if (genius && minted[id]) {
        try { const { url } = await genius.createLinkWithCode(affiliateUrl, (it.name || 'Walmart').slice(0, 80)); if (url) affiliateUrl = url } catch { /* keep minted */ }
      }
      return {
        asin: id,
        title: String(it.name).slice(0, 200),
        brand: null,
        image_url: it.image || null,
        price_now_cents: dollarsToCents(it.price),
        price_was_cents: dollarsToCents(it.oldPrice),
        discount_pct: it.discountPct != null ? Math.round(Number(it.discountPct)) : null,
        deal_quality: null,
        lowest_label: null,
        affiliateUrl,
      }
    }))

    const gate = await spendGate(user.id, tier)
    if (gate) return gate

    const client = createAnthropicClient()
    const nicheLabel = nicheLabelFrom(niches)
    const monthYear = new Date().toLocaleString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' })
    const { title, html, excerpt, theme } = await generateDigestContent({
      client, deals, reviewerName: (brand?.name as string) || 'the team', nicheLabel, monthYear, retailer: 'Walmart',
      recordUsage: (msg) => recordAnthropicUsage(msg, { userId: user.id, tier, feature: 'walmart_roundup', model: 'claude-haiku-4-5-20251001' }),
    })

    const disc = ((brand?.affiliate_disclaimer as string | null) || '').trim() || DEFAULT_DISCLOSURE
    const bodyHtml = `<p class="mvp-affiliate-disclosure" style="font-size:13px;color:#6b6b70;font-style:italic;margin:0 0 1.25em"><em>${esc(disc)}</em></p>\n\n${html}`

    const wpService = createWordPressService(site.wordpress_url, site.wordpress_username, site.wordpress_app_password, site.wordpress_api_token || undefined)
    let categoryIds: number[] = []
    try { const id = await wpService.createCategory('Deals'); if (id) categoryIds = [id] } catch { /* leave as-is */ }
    let featuredMediaId: number | null = null
    const heroImage = items.find((it) => it.image)?.image
    if (heroImage) {
      try {
        const media = await wpService.uploadImageFromUrl(heroImage, `${(theme || 'deals').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'deals'}-walmart-roundup.jpg`)
        featuredMediaId = (media?.id as number | undefined) ?? null
      } catch (err) { console.warn('[walmart/roundup] featured image upload failed:', err instanceof Error ? err.message : err) }
    }
    const slug = keywordSlug(title, theme)
    const wpPost = await wpService.createPost({
      title, slug, content: bodyHtml, excerpt,
      status: 'publish', comment_status: 'closed', ping_status: 'closed',
      ...(categoryIds.length ? { categories: categoryIds } : {}),
      ...(featuredMediaId ? { featured_media: featuredMediaId } : {}),
    })

    const seoKeyword = theme || nicheLabel
    const { data: saved } = await sb.from('blog_posts').insert({
      user_id: user.id, video_id: null, title, slug, content: bodyHtml, excerpt: null,
      wordpress_post_id: wpPost.id, wordpress_url: wpPost.link, wordpress_site_id: site.site_id,
      status: 'published', post_type: 'deal', seo_keyword: seoKeyword,
      deal_meta: { kind: 'walmart_roundup', itemIds },
      published_at: new Date().toISOString(),
    }).select('id').single()

    if (saved?.id) {
      try {
        await applyPostFixes({
          supabase, userId: user.id, wpService, wpBase: site.wordpress_url.replace(/\/+$/, ''), tier,
          post: { id: saved.id as string, title, slug, content: bodyHtml, seo_keyword: seoKeyword, post_type: 'deal', wordpress_post_id: wpPost.id },
          fixes: 'all',
        })
      } catch (err) { console.warn('[walmart/roundup] SEO fix failed (post live):', err instanceof Error ? err.message : err) }
    }

    return NextResponse.json({ ok: true, url: wpPost.link, count: deals.length })
  } catch (err) {
    console.error('[walmart/roundup]', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: toUserMessage(err, "Couldn't build the roundup just now. Please try again in a moment.") }, { status: 500 })
  }
}
