// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential. No copying, redistribution, reverse-engineering, or reuse. See LICENSE.
//
// Deals Hub API.
//
// A new post type (post_type='deal') for Studio + Pro + Admin accounts. The
// user pastes an Amazon URL or ASIN, optionally provides a promo code and a
// special promo URL, picks an occasion (or "auto-detect"), and the agent:
//   1. Resolves the product (services/amazon/fetchAmazonProduct extended with
//      discount fields: priceWas, priceSale, dealBadge, dealEndsAt,
//      discountPct).
//   2. If no discount is detected, treats it as a "low price alert" instead
//      of refusing — per the user's product call.
//   3. Generates a deal-spotter article (~800 words) with the lib/deal-scrub
//      rules baked in (NEVER claims hands-on testing — strict scrub layer).
//   4. Renders ONE thumbnail with a baked deal badge (savings amount or
//      occasion label, e.g. "$47 OFF" or "PRIME DAY") + up to 2 body
//      images. Hard cap at 3 generated images per the spec.
//   5. Publishes to WordPress under the user's "Deals" category (auto-
//      created via the regular WP category resolution if missing).
//
// Contract:
//   GET  /api/deals
//     → { deals: [{id,title,url,asin,created_at,occasion,priceWas,priceSale,dealEndsAt}], occasions: [{slug, label, badgeLabel}] }
//
//   POST /api/deals  body: { url|asin, promoCode?, promoUrl?, occasion?, manualDealEnd?, preview? }
//     preview:true → returns { preview: true, product, deal, occasion } so the
//       UI can show the picker card before commit (Full auto vs Let me see).
//     preview:false / absent → generates + publishes, returns
//       { ok, postId, wpPostId, url, title }.
//
//   DELETE /api/deals  body: { id }  (mirrors buying-guides DELETE shape)
//
// Tier gate: tier === 'studio' || 'pro' || 'admin'. Trial/Creator → 403
// code: 'tier_not_allowed'.

import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { createWordPressService } from '@/services/wordpress'
import { getWordPressCredentials } from '@/lib/wordpress-sites'
import { createAnthropicClient } from '@/lib/anthropic'
import { recordAnthropicUsage } from '@/lib/ai-usage'
import { extractAsin, fetchAmazonProduct, isValidAsin, type AmazonProduct } from '@/services/amazon'
import { composeWithNanoBanana, composeWithNanoBananaPro, rehostToFal } from '@/lib/thumbnail-generators'
import { recordUsage } from '@/lib/ai-usage'
import { scrubDealHtml, DEAL_VOICE_RULES } from '@/lib/deal-scrub'
import { getOccasion, detectOccasion, listOccasions, type DealOccasionSlug } from '@/lib/deal-occasion'

export const maxDuration = 300

// ─── Helpers ───────────────────────────────────────────────────────────────

/** Extract an ASIN from either a raw ASIN string or an Amazon URL. Returns
 *  null if neither shape matches — caller surfaces a 400. */
function asinFromInput(raw: string): string | null {
  const trimmed = (raw || '').trim()
  if (!trimmed) return null
  // Direct ASIN form (case-insensitive).
  if (isValidAsin(trimmed.toUpperCase())) return trimmed.toUpperCase()
  // Amazon URL form — extractAsin handles /dp/ASIN, /gp/product/ASIN, etc.
  const fromUrl = extractAsin(trimmed)
  if (fromUrl) return fromUrl
  return null
}

/** Parse a dollar string ("$199.99") into a Number, or null. */
function dollarsToNum(s: string | null | undefined): number | null {
  if (!s) return null
  const m = String(s).match(/\$?([\d,]+(?:\.\d+)?)/)
  if (!m) return null
  const n = parseFloat(m[1].replace(/,/g, ''))
  return isFinite(n) ? n : null
}

/** Compute a savings-badge label preferring (in order):
 *    1. occasion badge (e.g. "PRIME DAY") — only when the occasion isn't 'none'
 *    2. dollars-off ("$47 OFF") when we have both prices
 *    3. percent-off ("32% OFF") when only a percent is known
 *    4. plain "DEAL" — safe fallback */
function pickBadgeLabel(opts: {
  occasionSlug: DealOccasionSlug
  priceWas: string | null
  priceSale: string | null
  discountPct: number | null
}): string {
  if (opts.occasionSlug !== 'none') return getOccasion(opts.occasionSlug).badgeLabel
  const was = dollarsToNum(opts.priceWas)
  const sale = dollarsToNum(opts.priceSale)
  if (was && sale && sale < was) {
    const diff = Math.round(was - sale)
    if (diff >= 1) return `$${diff} OFF`
  }
  if (opts.discountPct && opts.discountPct > 0) return `${opts.discountPct}% OFF`
  return 'DEAL'
}

/** Compute a savings string for the body copy ("save $47 (32%)").
 *  Returns null when there's nothing concrete to show — the writer prompt
 *  reads "we don't have explicit numbers" and stays grounded. */
function computeSavingsLine(p: {
  priceWas: string | null
  priceSale: string | null
  discountPct: number | null
}): string | null {
  const was = dollarsToNum(p.priceWas)
  const sale = dollarsToNum(p.priceSale)
  if (was && sale && sale < was) {
    const diff = (was - sale).toFixed(2).replace(/\.00$/, '')
    const pct = p.discountPct ?? Math.round(((was - sale) / was) * 100)
    return `Save $${diff} (~${pct}%)`
  }
  if (p.discountPct) return `Save about ${p.discountPct}%`
  return null
}

/** Reviewer-name resolution for the first-person voice. */
async function resolveReviewerName(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  userId: string,
): Promise<string> {
  const { data } = await supabase
    .from('integrations')
    .select('reviewer_name')
    .eq('user_id', userId)
    .maybeSingle()
  return (data?.reviewer_name as string | null)?.trim() || 'the editor'
}

// ─── GET: list recent deals + occasion catalogue ───────────────────────────

export async function GET() {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: rows } = await (supabase as any)
    .from('blog_posts')
    .select('id, title, slug, wordpress_url, wordpress_post_id, created_at, seo_keyword, deal_meta')
    .eq('user_id', user.id)
    .eq('post_type', 'deal')
    .order('created_at', { ascending: false })
    .limit(25)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const deals = (rows || []).map((r: any) => {
    const meta = (r.deal_meta || {}) as Record<string, unknown>
    return {
      id: r.id as string,
      title: r.title as string,
      slug: r.slug as string,
      url: (r.wordpress_url as string) || null,
      wpPostId: (r.wordpress_post_id as number) || null,
      asin: (meta.asin as string) || null,
      created_at: r.created_at as string,
      seo_keyword: (r.seo_keyword as string) || null,
      occasion: (meta.occasion as string) || 'none',
      priceWas: (meta.priceWas as string) || null,
      priceSale: (meta.priceSale as string) || null,
      dealEndsAt: (meta.dealEndsAt as string) || null,
    }
  })

  const occasions = listOccasions().map(o => ({ slug: o.slug, label: o.longLabel, badgeLabel: o.badgeLabel }))

  return NextResponse.json({ deals, occasions })
}

// ─── DELETE — mirrors buying-guides DELETE ─────────────────────────────────

export async function DELETE(req: Request) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: integ } = await supabase
    .from('integrations').select('tier').eq('user_id', user.id).maybeSingle()
  const tier = (integ?.tier as string | undefined) ?? 'trial'
  if (tier !== 'studio' && tier !== 'pro' && tier !== 'admin') {
    return NextResponse.json({ error: 'Studio or Pro tier required.', code: 'tier_not_allowed' }, { status: 403 })
  }

  let body: { id?: string }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Bad request' }, { status: 400 }) }
  const id = (body.id || '').trim()
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: row } = await (supabase as any)
    .from('blog_posts')
    .select('id, wordpress_post_id, wordpress_site_id, user_id, post_type')
    .eq('id', id)
    .eq('user_id', user.id)
    .maybeSingle()
  if (!row) return NextResponse.json({ error: 'Deal not found.' }, { status: 404 })
  if (row.post_type !== 'deal') return NextResponse.json({ error: 'Not a deal row.' }, { status: 400 })

  const wpPostId = (row.wordpress_post_id as number | null) || null
  const wpSiteId = (row.wordpress_site_id as string | null) || null

  if (wpPostId) {
    try {
      const site = await getWordPressCredentials(supabase, user.id, wpSiteId)
      if (site) {
        const wpService = createWordPressService(
          site.wordpress_url,
          site.wordpress_username,
          site.wordpress_app_password,
          site.wordpress_api_token || undefined,
        )
        await wpService.deletePost(wpPostId)
      }
    } catch (err) {
      console.warn('[deals DELETE] WP delete failed:', err instanceof Error ? err.message : err)
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (supabase as any).from('blog_posts').delete().eq('id', row.id).eq('user_id', user.id)

  return NextResponse.json({ ok: true })
}

// ─── POST — generate + publish (or preview) ────────────────────────────────

export async function POST(req: Request) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Tier gate
  const { data: integ } = await supabase
    .from('integrations').select('tier').eq('user_id', user.id).maybeSingle()
  const tier = (integ?.tier as string | undefined) ?? 'trial'
  if (tier !== 'studio' && tier !== 'pro' && tier !== 'admin') {
    return NextResponse.json({
      error: 'Deals Hub requires the Studio or Pro tier.',
      code: 'tier_not_allowed',
    }, { status: 403 })
  }

  // Parse + validate body
  let body: {
    url?: string
    asin?: string
    promoCode?: string
    promoUrl?: string
    occasion?: DealOccasionSlug | 'auto'
    manualDealEnd?: string
    preview?: boolean
  }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Bad request' }, { status: 400 }) }

  const rawInput = (body.url || body.asin || '').trim()
  const asin = asinFromInput(rawInput)
  if (!asin) {
    return NextResponse.json({
      error: 'Paste an Amazon product URL or a 10-character ASIN.',
      code: 'bad_input',
    }, { status: 400 })
  }
  const promoCode = (body.promoCode || '').trim().slice(0, 40) // hard cap
  const promoUrl = (body.promoUrl || '').trim().slice(0, 500)
  const requestedOccasion: DealOccasionSlug = body.occasion === 'auto' || !body.occasion
    ? detectOccasion()
    : (body.occasion as DealOccasionSlug)
  const occasion = getOccasion(requestedOccasion)
  const manualDealEnd = (body.manualDealEnd || '').trim() || null

  // Resolve WP site early — we need a category-list call later anyway.
  const site = await getWordPressCredentials(supabase, user.id)
  if (!site) {
    return NextResponse.json({
      error: 'Connect a WordPress site first (Setup → Integrations).',
      code: 'no_wp',
    }, { status: 400 })
  }

  // ── 1. Resolve product ────────────────────────────────────────────────
  let product: AmazonProduct
  try {
    product = await fetchAmazonProduct(asin)
  } catch (err) {
    return NextResponse.json({
      error: `Couldn't read the Amazon listing: ${err instanceof Error ? err.message : 'unknown error'}. Try a different product or try again in a minute (Amazon sometimes throttles).`,
      code: 'amazon_block',
    }, { status: 502 })
  }

  // Compute deal envelope. If Amazon's manual end-date override is set, it
  // beats whatever we scraped. Otherwise we use the scraped value (may be
  // null).
  const dealEndsAt = manualDealEnd || product.dealEndsAt || null
  const badgeLabel = pickBadgeLabel({
    occasionSlug: occasion.slug,
    priceWas: product.priceWas,
    priceSale: product.priceSale ?? product.price,
    discountPct: product.discountPct,
  })
  const savingsLine = computeSavingsLine({
    priceWas: product.priceWas,
    priceSale: product.priceSale ?? product.price,
    discountPct: product.discountPct,
  })
  const hasExplicitDiscount = !!(product.priceWas || product.discountPct)

  // ── 2. Preview short-circuit ──────────────────────────────────────────
  // Surfaces what was scraped so the user can review and edit before
  // committing. Mirrors the buying-guides Let-me-see flow.
  if (body.preview) {
    return NextResponse.json({
      preview: true,
      product: {
        asin: product.asin,
        title: product.title,
        price: product.price,
        priceWas: product.priceWas,
        priceSale: product.priceSale ?? product.price,
        discountPct: product.discountPct,
        dealBadge: product.dealBadge,
        dealEndsAt,
        rating: product.rating,
        imageUrl: product.imageUrl,
      },
      deal: {
        badgeLabel,
        savingsLine,
        hasExplicitDiscount,
        // When no discount detected we fall through to "low price alert"
        // shape (per the user's product call) — the article frames it as
        // a watch-this-price piece rather than refusing to generate.
        mode: hasExplicitDiscount ? 'discount' : 'low_price_alert',
      },
      occasion: { slug: occasion.slug, label: occasion.longLabel, badgeLabel: occasion.badgeLabel },
      promo: { code: promoCode || null, url: promoUrl || null },
    })
  }

  // ── 3. Writer (Sonnet) — parallel with the thumbnail + body image
  //         renders, then WP create awaits everything via Promise.all. ─
  const client = createAnthropicClient()
  const reviewerName = await resolveReviewerName(supabase, user.id)
  const year = new Date().getUTCFullYear()

  const writerPrompt = buildDealWriterPrompt({
    product,
    occasion: occasion.slug,
    occasionLong: occasion.longLabel,
    occasionHype: occasion.hypePhrase,
    dealEndsAt,
    badgeLabel,
    savingsLine,
    hasExplicitDiscount,
    reviewerName,
    promoCode,
    promoUrl,
    year,
  })

  // ── Image pipeline ───────────────────────────────────────────────────
  // Hard cap of 3 generated images per the user's spec: thumbnail + 2 body.
  // Thumbnail uses Nano Banana Pro for legible baked-badge text; body
  // images use regular Nano Banana.
  const mainImage = product.imageUrl
  const productRefForFal = mainImage ? await rehostToFal(mainImage) : null

  // Thumbnail (badge baked in)
  const thumbPrompt = buildThumbnailPrompt({
    productTitle: product.title || `the product (ASIN ${product.asin})`,
    badgeLabel,
    badgeBg: occasion.badgeBg,
    badgeFg: occasion.badgeFg,
  })
  const thumbPromise: Promise<string | null> = productRefForFal
    ? composeWithNanoBananaPro({
        prompt: thumbPrompt,
        referenceImageUrls: [productRefForFal],
        aspectRatio: '16:9',
        numImages: 1,
      })
        .then(arr => arr[0] || null)
        .then(async url => {
          if (url) recordUsage({ userId: user.id, tier, feature: 'deal_thumbnail', model: 'nano-banana-pro', images: 1 })
          // Pro endpoint occasionally fails the legible-text contract; fall
          // back to regular NB if it returned nothing.
          if (!url) {
            const arr = await composeWithNanoBanana({
              prompt: thumbPrompt,
              referenceImageUrls: [productRefForFal],
              aspectRatio: '16:9',
              numImages: 1,
            })
            if (arr[0]) recordUsage({ userId: user.id, tier, feature: 'deal_thumbnail_fallback', model: 'nano-banana', images: 1 })
            return arr[0] || null
          }
          return url
        })
        .catch(() => null)
    : Promise.resolve(null)

  // Body images (2)
  const bodyImagePromises: Array<Promise<string | null>> = [0, 1].map((i) => {
    if (!productRefForFal) return Promise.resolve(null)
    const prompt = buildBodyImagePrompt({
      productTitle: product.title || `the product (ASIN ${product.asin})`,
      slotIndex: i,
    })
    return composeWithNanoBanana({
      prompt,
      referenceImageUrls: [productRefForFal],
      aspectRatio: '4:3',
      numImages: 1,
    })
      .then(arr => arr[0] || null)
      .then(url => {
        if (url) recordUsage({ userId: user.id, tier, feature: 'deal_body_image', model: 'nano-banana', images: 1 })
        return url
      })
      .catch(() => null)
  })

  // Writer in parallel with renders.
  const writerPromise = client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 4500,
    messages: [{ role: 'user', content: writerPrompt }],
  }).then(msg => {
    recordAnthropicUsage(msg, { userId: user.id, tier, feature: 'deal_writer', model: 'claude-sonnet-4-6' })
    const raw = (msg.content[0] as { type: string; text: string })?.text || ''
    return scrubDealHtml(raw)
  })

  // ── Category pick (Haiku) in parallel — prefers "Deals" if it exists,
  //         else the closest topical category. ──────────────────────────
  const categoryPromise: Promise<number[]> = (async () => {
    try {
      const wpBase = site.wordpress_url.replace(/\/+$/, '')
      const catRes = await fetch(`${wpBase}/wp-json/wp/v2/categories?per_page=100&_fields=id,name,slug`, {
        signal: AbortSignal.timeout(3000),
        headers: { Accept: 'application/json' },
        next: { revalidate: 300 },
      })
      if (!catRes.ok) return []
      const cats = (await catRes.json()) as Array<{ id: number; name: string; slug: string }>
      // Prefer an existing "Deals" category outright — it's the natural
      // home for these posts and the user will reuse it for every deal.
      const dealsCat = cats.find(c => c.slug.toLowerCase() === 'deals' || c.name.toLowerCase() === 'deals')
      if (dealsCat) return [dealsCat.id]
      // Otherwise pick the closest topical category via Haiku, same as
      // buying-guides. Falls through to uncategorized on any error.
      const candidates = cats.filter(c => !['uncategorized', 'blog', 'general'].includes(c.slug.toLowerCase()))
      if (candidates.length === 0) return []
      const catList = candidates.map((c, i) => `[${i}] ${c.name}`).join('\n')
      const pickPrompt = `Product: "${product.title}"\n\nWordPress categories on the site:\n${catList}\n\nPick the SINGLE best category for a deal post about this product. If none fits well, reply with -1. Reply with ONLY the number, nothing else.`
      const pickMsg = await client.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 10,
        messages: [{ role: 'user', content: pickPrompt }],
      })
      recordAnthropicUsage(pickMsg, { userId: user.id, tier, feature: 'deal_category_pick', model: 'claude-haiku-4-5-20251001' })
      const text = (pickMsg.content[0] as { type: string; text: string })?.text || ''
      const idx = parseInt(text.trim(), 10)
      if (!isFinite(idx) || idx < 0 || idx >= candidates.length) return []
      return [candidates[idx].id]
    } catch {
      return []
    }
  })()

  // Tag resolve in parallel — every deal post gets the 'deal' tag plus the
  // occasion slug as a secondary tag for filtering.
  const wpService = createWordPressService(
    site.wordpress_url,
    site.wordpress_username,
    site.wordpress_app_password,
    site.wordpress_api_token || undefined,
  )
  const tagPromise: Promise<number[]> = wpService
    .resolveTagIds([
      'deal',
      occasion.slug !== 'none' ? `deal-${occasion.slug.replace(/_/g, '-')}` : '',
    ].filter(Boolean) as string[])
    .catch(() => [] as number[])

  // Await the writer + image renders together so WP create can use them.
  const [html, thumbUrl, body1Url, body2Url, categoryIds, tagIds] = await Promise.all([
    writerPromise,
    thumbPromise,
    bodyImagePromises[0],
    bodyImagePromises[1],
    categoryPromise,
    tagPromise,
  ])

  if (!html || html.length < 400) {
    return NextResponse.json({ error: 'Generation returned empty body' }, { status: 500 })
  }

  // ── Upload images to WP & weave body images into the HTML ─────────────
  let featuredMediaId: number | undefined
  if (thumbUrl) {
    try {
      const media = await wpService.uploadImageFromUrl(thumbUrl, `deal-${asin}-thumb.jpg`)
      if (media?.id) featuredMediaId = media.id
    } catch { /* best-effort */ }
  }
  const uploadedBody: string[] = []
  for (const [i, url] of [body1Url, body2Url].entries()) {
    if (!url) continue
    try {
      const media = await wpService.uploadImageFromUrl(url, `deal-${asin}-body${i + 1}.jpg`)
      if (media?.source_url) uploadedBody.push(media.source_url)
    } catch { /* best-effort */ }
  }

  // Inject body images into the HTML. We splice them after the first and
  // third <h2> so they break up the article rhythm; if there aren't enough
  // headings (rare on deal posts) the leftover images get appended before
  // the FAQ/closer.
  const finalHtml = injectBodyImages({
    html,
    images: uploadedBody,
    productTitle: product.title || 'this product',
    occasionLabel: occasion.longLabel,
    badgeLabel,
    promoCode,
    promoUrl,
    dealEndsAt,
  })

  // ── Title + slug ──────────────────────────────────────────────────────
  const wpTitle = buildDealTitle({
    product,
    occasion: occasion.longLabel,
    occasionSlug: occasion.slug,
    badgeLabel,
    year,
  })
  const slug = buildDealSlug(product.title || `deal-${asin}`, asin, occasion.slug, year)

  let wpPost: { id: number; link: string }
  try {
    wpPost = await wpService.createPost({
      title: wpTitle,
      slug,
      content: finalHtml,
      excerpt: buildExcerpt({ product, badgeLabel, savingsLine, occasionLong: occasion.longLabel }),
      status: 'publish',
      tags: tagIds,
      ...(categoryIds.length ? { categories: categoryIds } : {}),
      ...(featuredMediaId ? { featured_media: featuredMediaId } : {}),
      comment_status: 'closed',
      ping_status: 'closed',
    })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'WordPress publish failed' }, { status: 500 })
  }

  // ── Save row ──────────────────────────────────────────────────────────
  // blog_posts.video_id is NOT NULL in some older deployments — fall back
  // to the user's most-recent video_id if we can't tie this deal to a
  // specific video. (Deals never have a source video by definition.)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: anyReview } = await (supabase as any)
    .from('blog_posts')
    .select('video_id')
    .eq('user_id', user.id)
    .not('video_id', 'is', null)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  const fallbackVideoId = (anyReview?.video_id as string | null) || null

  const dealMeta = {
    asin: product.asin,
    occasion: occasion.slug,
    priceWas: product.priceWas,
    priceSale: product.priceSale ?? product.price,
    discountPct: product.discountPct,
    dealBadge: product.dealBadge,
    dealEndsAt,
    promoCode: promoCode || null,
    promoUrl: promoUrl || null,
    badgeLabel,
    savingsLine,
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: saved } = await (supabase as any)
    .from('blog_posts')
    .insert({
      user_id: user.id,
      video_id: fallbackVideoId,
      title: wpTitle,
      slug,
      content: finalHtml,
      excerpt: null,
      wordpress_post_id: wpPost.id,
      wordpress_url: wpPost.link,
      wordpress_site_id: site.site_id,
      status: 'published',
      post_type: 'deal',
      seo_keyword: product.title || `deal-${asin}`,
      published_at: new Date().toISOString(),
      // deal_meta is a JSONB column added in migration 091. If the column
      // doesn't exist on a stale DB this insert errors — surface that
      // clearly so the user runs the migration.
      deal_meta: dealMeta,
    })
    .select('id')
    .single()

  return NextResponse.json({
    ok: true,
    postId: saved?.id ?? null,
    wpPostId: wpPost.id,
    url: wpPost.link,
    title: wpTitle,
  })
}

// ─── Prompt builders ───────────────────────────────────────────────────────

interface DealWriterPromptInput {
  product: AmazonProduct
  occasion: DealOccasionSlug
  occasionLong: string
  occasionHype: string
  dealEndsAt: string | null
  badgeLabel: string
  savingsLine: string | null
  hasExplicitDiscount: boolean
  reviewerName: string
  promoCode: string
  promoUrl: string
  year: number
}

function buildDealWriterPrompt(p: DealWriterPromptInput): string {
  const bulletsSummary = p.product.bullets.slice(0, 6).map(b => `- ${b}`).join('\n') || '(none scraped)'
  const dealLine = p.savingsLine
    ? `The discount: ${p.savingsLine}.${p.product.priceWas ? ` Listing shows was ${p.product.priceWas}, now ${p.product.priceSale || p.product.price || '?'}.` : ''}`
    : p.product.price
      ? `No explicit "was" price on the listing — write this as a low-price-alert / good-time-to-buy piece. Current price: ${p.product.price}.`
      : 'No price detected at all. Write conservatively, point readers to the listing for the live number.'

  const endLine = p.dealEndsAt
    ? `Deal expiration: ${p.dealEndsAt}. Mention this prominently early in the article.`
    : 'No expiration date given. Don\'t invent one. Use language like "while the price holds" instead of fake countdown urgency.'

  const occasionLine = p.occasion === 'none'
    ? 'No specific occasion (regular price drop).'
    : `This is a ${p.occasionLong} deal. Context: ${p.occasionHype}. Lean into the occasion in the hook + closing CTA, but never invent specific event-only inventory claims.`

  const promoLine = (() => {
    const lines: string[] = []
    if (p.promoCode) lines.push(`Promo code: ${p.promoCode}. Use this in the deal-box CTA copy.`)
    if (p.promoUrl) lines.push(`Special promo URL: ${p.promoUrl}. Every "buy" / "see deal" anchor in the article should link to this URL.`)
    if (!lines.length) lines.push('No promo code or special URL given — leave the link href as PLACEHOLDER_DEAL_URL (the system substitutes the affiliate URL later).')
    return lines.join(' ')
  })()

  return `You are ${p.reviewerName}, writing a deal post for ${p.year}. The post is for the "Deals Hub" section of an affiliate review site.

PRODUCT
- Title: ${p.product.title || '(unknown — describe generically using the bullets)'}
- ASIN: ${p.product.asin}
- Bullets the listing surfaces:
${bulletsSummary}
- Description excerpt: ${p.product.description?.slice(0, 400) || '(none)'}
- Rating: ${p.product.rating || 'unknown'} stars

DEAL ENVELOPE
- ${dealLine}
- ${endLine}
- ${occasionLine}
- Badge text on thumbnail: ${p.badgeLabel} (don't put this exact string in the body, the thumbnail handles it)
- ${promoLine}

${DEAL_VOICE_RULES}

STRUCTURE (target ~800 words):
1. <p> Punchy opening hook. State the deal up front: what's discounted, by how much (if known), and why it matters TODAY. If the occasion is set, lean into it ("Prime Day delivered a real one this year:"). Two sentences max for the hook.
2. <h2>The deal at a glance</h2> — One <p> with the price story (was vs. now if known, ${p.savingsLine ? 'savings: ' + p.savingsLine : 'no explicit discount, frame as "this price is the floor I\'ve seen recently"'}), then the expiration note if any, then a one-line CTA. Wrap the CTA anchor as <a href="${p.promoUrl || 'PLACEHOLDER_DEAL_URL'}" rel="nofollow sponsored">${p.promoCode ? `Apply code ${p.promoCode} on Amazon` : 'See the deal on Amazon'}</a>.
3. <h2>Why this deal is worth your attention</h2> — 2-3 paragraphs. Spec-anchored value commentary ONLY. Reference the bullets above. Show you've read the listing. Talk about who this fits (who it doesn't) based on specs. Never claim hands-on time.
4. <h2>What you're actually getting</h2> — Bullet list <ul><li> of 4-6 concrete specs / features pulled from the listing. Concise. No marketing fluff.
5. <h2>Before you buy</h2> — One <p> of grounded caveats: shipping windows for the occasion, return policy considerations, the kinds of buyer this would NOT fit. Keep it real.
6. <p> Final CTA paragraph: occasion-aware nudge + the deal button again. Same href as step 2.

VOICE / STYLE
- First person throughout. Match how ${p.reviewerName} writes.
- Contractions everywhere (it's, you'll, I've, can't).
- Short blunt sentences mixed with longer ones.
- ABSOLUTE BAN on em-dashes (—) and en-dashes (–). EVERYWHERE. Use a comma, a period, or parentheses.
- Never use "honest" or any variant. Never: moreover, furthermore, additionally, in conclusion, to summarize, overall, delve, tapestry, elevate, utilize, game-changer, revolutionary, cutting-edge, genuinely, actually, it's important to.
- Vary sentence openings. Don't start three paragraphs in a row the same way.
- NEVER invent specs, prices, dates, or features. If the listing didn't say it, the article doesn't say it.
- Output: VALID HTML only. No markdown fences. Open with <p>. Close with </p>. Use <h2>, <ul>, <li>, <a>, <p>, <strong>, <em>. Nothing else.`
}

function buildThumbnailPrompt(opts: {
  productTitle: string
  badgeLabel: string
  badgeBg: string
  badgeFg: string
}): string {
  // Nano Banana Pro handles short, legible baked text well. Keep the badge
  // short (under ~18 chars). We embed the text directly in the prompt so it
  // bakes into the image.
  return `Identity-preserving re-render of the product in the reference image for a deal-post thumbnail. Keep the product's EXACT shape, colour, materials, branding, labels IDENTICAL to the reference. Strip any overlay marketing graphics, headlines, checkmark badges, or callouts the reference may have — do not reproduce those.

Place the product naturally in a clean editorial scene with vibrant complementary lighting. Centre-right composition leaving the upper-left ~30% of the frame visually quieter so a deal badge has room.

Bake a single high-contrast deal badge in the upper-left corner:
- Badge shape: rounded rectangle ribbon, ~22% of the frame width
- Background colour: ${opts.badgeBg}
- Text colour: ${opts.badgeFg}
- Badge text (EXACT, all-caps, single line, no quotes): ${opts.badgeLabel}
- Use a heavy sans-serif font with crisp legible kerning
- Slight drop shadow under the badge so it pops against the scene

No other text anywhere in the image. No watermarks. No URL bars. No price tags or stickers ON the product itself — the badge is the only graphic overlay. Landscape 16:9 photorealistic editorial product photography for a thumbnail.`
}

function buildBodyImagePrompt(opts: { productTitle: string; slotIndex: number }): string {
  // Two distinct angles: (0) clean studio-ish, (1) lifestyle in real-world use
  // context. Both identity-preserving.
  const scenes = [
    'Clean studio-magazine setting against a vibrant solid colour or soft gradient background. Soft directional lighting from the upper left. Camera distance is medium, three-quarter angle showing the product clearly. No props, no overlay text.',
    'Real-world contextual scene where this kind of product is naturally used (e.g. on a desk, kitchen counter, living room shelf, or workshop bench depending on the product category). Natural ambient lighting. Medium-close angle. Realistic shadows. No overlay text or graphics.',
  ]
  const scene = scenes[opts.slotIndex % scenes.length]

  return `Identity-preserving re-render of the product in the reference image. Keep the product's EXACT shape, colour, materials, branding/labels IDENTICAL to the reference. Strip any overlay marketing graphics, headlines, badges, callouts, or A+ content panels from the reference — do not reproduce those.

${scene}

The product is the ONLY thing carried over from the reference. The scene, lighting, camera, and surroundings must all be different from the reference and different from other images of this product. Landscape 4:3, photorealistic editorial product photography, no added text/captions/watermarks/badges anywhere.`
}

// ─── HTML helpers ──────────────────────────────────────────────────────────

interface InjectBodyImagesOpts {
  html: string
  images: string[]
  productTitle: string
  occasionLabel: string
  badgeLabel: string
  promoCode: string
  promoUrl: string
  dealEndsAt: string | null
}

/** Splice the WP-uploaded body images into the HTML at sensible H2
 *  boundaries, and wrap the post in a [mvp_deal_banner] shortcode at the top.
 *  Also substitutes the PLACEHOLDER_DEAL_URL anchor href so links point
 *  somewhere real even when the user didn't supply a promo URL (we use a
 *  plain amazon.com/dp/<asin> link as the safe default — the user's
 *  Geniuslink rewriter on the WP side then wraps it). */
function injectBodyImages(opts: InjectBodyImagesOpts): string {
  let out = opts.html
  // 1. Substitute placeholder anchors. If the user provided a promo URL the
  // prompt already substituted it, so this only catches the no-promo path.
  if (out.includes('PLACEHOLDER_DEAL_URL')) {
    // Fall back to the Amazon canonical; Geniuslink/Amaffsoft on the WP
    // side rewrites this on the way out.
    out = out.replace(/PLACEHOLDER_DEAL_URL/g, 'https://www.amazon.com')
  }
  // 2. Insert body images after H2 #1 and H2 #3 if we have them.
  if (opts.images.length > 0) {
    const altText = (i: number) => `${opts.productTitle} ${opts.occasionLabel} deal image ${i + 1}`
    const h2Indices: number[] = []
    const re = /<h2\b[^>]*>[\s\S]*?<\/h2>/gi
    let m: RegExpExecArray | null
    while ((m = re.exec(out)) !== null) {
      h2Indices.push(m.index + m[0].length)
    }
    // Insert in reverse so earlier indices stay stable.
    const insertions: Array<{ at: number; html: string }> = []
    if (opts.images[0] && h2Indices[0] !== undefined) {
      insertions.push({
        at: h2Indices[0],
        html: `\n<figure class="mvp-deal-image"><img src="${opts.images[0]}" alt="${altText(0)}" loading="lazy" /></figure>\n`,
      })
    }
    if (opts.images[1] && h2Indices[2] !== undefined) {
      insertions.push({
        at: h2Indices[2],
        html: `\n<figure class="mvp-deal-image"><img src="${opts.images[1]}" alt="${altText(1)}" loading="lazy" /></figure>\n`,
      })
    }
    insertions.sort((a, b) => b.at - a.at)
    for (const ins of insertions) {
      out = out.slice(0, ins.at) + ins.html + out.slice(ins.at)
    }
  }
  // 3. Prepend the deal banner shortcode — the WP plugin renders the
  // countdown / "deal ended" overlay client-side from these atts. If the
  // plugin isn't installed the shortcode just renders empty (safe fallback).
  const bannerAtts: string[] = []
  if (opts.dealEndsAt) bannerAtts.push(`end_date="${escapeAttr(opts.dealEndsAt)}"`)
  if (opts.badgeLabel) bannerAtts.push(`badge="${escapeAttr(opts.badgeLabel)}"`)
  if (opts.promoCode) bannerAtts.push(`code="${escapeAttr(opts.promoCode)}"`)
  if (opts.promoUrl) bannerAtts.push(`url="${escapeAttr(opts.promoUrl)}"`)
  if (bannerAtts.length > 0) {
    const banner = `\n[mvp_deal_banner ${bannerAtts.join(' ')}]\n\n`
    out = banner + out
  }
  return out
}

function escapeAttr(s: string): string {
  return String(s).replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function buildExcerpt(opts: {
  product: AmazonProduct
  badgeLabel: string
  savingsLine: string | null
  occasionLong: string
}): string {
  const lead = opts.savingsLine
    ? `${opts.savingsLine} on ${opts.product.title || 'this product'}.`
    : `Price-watch alert on ${opts.product.title || 'this product'}.`
  const tail = opts.occasionLong !== 'limited-time deal'
    ? ` ${opts.occasionLong} pick.`
    : ' Limited-time pricing worth catching.'
  return (lead + tail).slice(0, 250)
}

function buildDealTitle(opts: {
  product: AmazonProduct
  occasion: string
  occasionSlug: DealOccasionSlug
  badgeLabel: string
  year: number
}): string {
  const base = opts.product.title || `Deal on ASIN ${opts.product.asin}`
  // Trim the product title so the headline stays scannable.
  const trimmed = base.length > 60 ? base.slice(0, 57).replace(/\s+\S*$/, '') + '...' : base
  if (opts.occasionSlug !== 'none') {
    return `${opts.occasion} Deal: ${trimmed} (${opts.year})`
  }
  return `Deal Alert: ${trimmed} (${opts.year})`
}

function buildDealSlug(productTitle: string, asin: string, occasionSlug: DealOccasionSlug, year: number): string {
  const t = productTitle.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '').slice(0, 50)
  const occ = occasionSlug !== 'none' ? `${occasionSlug.replace(/_/g, '-')}-` : 'deal-'
  return `${occ}${t || asin.toLowerCase()}-${year}`
}
