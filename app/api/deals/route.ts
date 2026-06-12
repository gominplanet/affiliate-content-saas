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
import { isStalePostError, WP_STALE_POST_MESSAGE } from '@/lib/wp-errors'
import { getWordPressCredentials } from '@/lib/wordpress-sites'
import { createAnthropicClient } from '@/lib/anthropic'
import { recordAnthropicUsage } from '@/lib/ai-usage'
import { extractAsin, fetchAmazonProduct, isValidAsin, type AmazonProduct } from '@/services/amazon'
import { resolveFinalUrl } from '@/lib/product-link'
import { composeWithNanoBanana, composeWithNanoBananaPro, rehostToFal } from '@/lib/thumbnail-generators'
import { recordUsage } from '@/lib/ai-usage'
import { scrubDealHtml, DEAL_VOICE_RULES } from '@/lib/deal-scrub'
import { scrubEmDashes } from '@/lib/html-scrub'
import { getOccasion, detectOccasion, listOccasions, type DealOccasionSlug } from '@/lib/deal-occasion'
import { checkDealsUsage } from '@/lib/tier'
import { spendGate } from '@/lib/ai-spend'

export const maxDuration = 300

// ─── Helpers ───────────────────────────────────────────────────────────────

/** A short-link shortener pattern. Geniuslink (geni.us), Amazon's own
 *  shorteners (amzn.to, a.co), and a few common third-party services all
 *  hash the underlying URL. We unwrap them via HEAD-follow before trying
 *  to extract the ASIN. */
const SHORT_LINK_RE = /(?:geni\.us|amzn\.to|a\.co|bit\.ly|tinyurl\.com|rebrand\.ly|rstyle\.me|shareasale\.com)/i

/** Extract an ASIN from a free-form input. Accepts:
 *    - A bare ASIN ("B0XXXXXXXX")
 *    - A direct Amazon URL (/dp/ASIN, /gp/product/ASIN)
 *    - A short link (amzn.to, a.co, geni.us, etc.) → resolved via HEAD
 *      follow, then ASIN extracted from the final URL
 *    - A Geniuslink wrapper → same as short-link path
 *  Returns null if no ASIN can be coaxed out, so the caller can surface a
 *  clear "we couldn't find an Amazon product behind that link" error. */
async function asinFromInput(raw: string): Promise<string | null> {
  const trimmed = (raw || '').trim()
  if (!trimmed) return null
  // Direct ASIN form (case-insensitive).
  if (isValidAsin(trimmed.toUpperCase())) return trimmed.toUpperCase()
  // Try ASIN extraction on the raw input first (handles direct Amazon URLs
  // without paying the HEAD round-trip).
  const directAsin = extractAsin(trimmed)
  if (directAsin) return directAsin
  // Short-link / affiliate-link unwrap. resolveFinalUrl HEAD-follows
  // redirects up to a small cap and returns the final URL string.
  if (SHORT_LINK_RE.test(trimmed)) {
    try {
      const resolved = await resolveFinalUrl(trimmed)
      const fromResolved = extractAsin(resolved)
      if (fromResolved) return fromResolved
    } catch {
      // Network/redirect failure — fall through to null. The caller's
      // error message tells the user to paste the Amazon URL directly.
    }
  }
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

  // Resilient read: if the user hasn't applied migration 093 yet (which
  // adds the deal_meta JSONB column), the full SELECT errors and silently
  // returns nothing. We try the full query first; on the specific
  // column-missing error, we retry without deal_meta so the user at least
  // sees their deal-post titles + WP links until they run the migration.
  // Other errors get surfaced via `dbError` so the client can toast them.

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let rows: any[] | null = null
  let dbError: string | null = null
  let missingMeta = false

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const first = await (supabase as any)
    .from('blog_posts')
    .select('id, title, slug, wordpress_url, wordpress_post_id, created_at, seo_keyword, status, deal_meta')
    .eq('user_id', user.id)
    .eq('post_type', 'deal')
    .order('created_at', { ascending: false })
    .limit(25)

  if (first.error) {
    const msg = String(first.error?.message || '')
    const details = String((first.error as { details?: string })?.details || '')
    const hint = String((first.error as { hint?: string })?.hint || '')
    const code = String(first.error?.code || '')
    console.error('[deals GET] full select failed:', first.error)
    // Detect missing migration 093 from any field Postgres / Supabase
    // might surface it on: message, code (42703), details, or hint. The
    // earlier check only looked at message + code, which silently missed
    // the case where Supabase wraps the column-missing error and puts the
    // identifier in `details` instead.
    if (/deal_meta/i.test(msg) || /column .* does not exist/i.test(msg) || /deal_meta/i.test(details) || /deal_meta/i.test(hint) || code === '42703') {
      // Migration 093 not applied. Fall back to the meta-less columns so
      // the user still sees deal post titles + URLs while we tell them
      // to run the migration.
      missingMeta = true
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const fallback = await (supabase as any)
        .from('blog_posts')
        .select('id, title, slug, wordpress_url, wordpress_post_id, created_at, seo_keyword')
        .eq('user_id', user.id)
        .eq('post_type', 'deal')
        .order('created_at', { ascending: false })
        .limit(25)
      if (fallback.error) {
        console.error('[deals GET] fallback select failed:', fallback.error)
        dbError = `Couldn't load Recent deals: ${fallback.error.message || 'database error'}`
      } else {
        rows = fallback.data || []
      }
    } else {
      dbError = `Couldn't load Recent deals: ${msg || 'database error'}`
    }
  } else {
    rows = first.data || []
  }

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
      // Status surfaced for the UI's Live/Scheduled pill. Falls through
      // to 'published' for pre-feature rows (status NULL on legacy data).
      status: (r.status as string) || 'published',
      scheduledAt: (meta.scheduledAt as string) || null,
    }
  })

  const occasions = listOccasions().map(o => ({ slug: o.slug, label: o.longLabel, badgeLabel: o.badgeLabel }))

  return NextResponse.json({
    deals,
    occasions,
    ...(dbError ? { dbError } : {}),
    ...(missingMeta ? { migrationNeeded: '093_blog_posts_deal_meta' } : {}),
  })
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

  // Tier gate + monthly cap (Studio 5/mo, Pro 30/mo). checkDealsUsage
  // does both: the access gate (cap === 0 means tier doesn't get Deals)
  // and the monthly counter. Wired in 2026-06-04 audit — was previously
  // only blocking by raw tier, so Studio + Pro could publish unlimited
  // deals against the per-tier cap defined in lib/tier.ts.
  const dealsCheck = await checkDealsUsage(supabase, user.id)
  if (!dealsCheck.allowed) {
    return NextResponse.json({
      error: dealsCheck.reason,
      code: 'tier_not_allowed',
      currentTier: dealsCheck.tier,
      cap: dealsCheck.cap,
      used: dealsCheck.used,
      upgrade: dealsCheck.upgrade,
    }, { status: dealsCheck.cap === 0 ? 403 : 429 })
  }
  const tier = dealsCheck.tier

  // Monthly AI-spend circuit breaker (Sonnet writer + nano-banana thumbnails).
  const spendBlocked = await spendGate(user.id, tier)
  if (spendBlocked) return spendBlocked

  // Parse + validate body
  let body: {
    url?: string
    asin?: string
    promoCode?: string
    promoUrl?: string
    occasion?: DealOccasionSlug | 'auto'
    manualDealEnd?: string
    preview?: boolean
    /** Regenerate path: when set, ignores the other inputs and replays the
     *  generation with whatever's saved in the row's deal_meta. After the
     *  new post publishes successfully, the old row + WP post get deleted.
     *  Lets the user re-render a stale deal with the same ASIN/promo/
     *  occasion without re-typing anything. */
    regenerateId?: string
    /** Refresh-price path: light cousin of regenerate. Re-scrapes the
     *  product for current pricing, runs a cheap Sonnet patch pass that
     *  rewrites ONLY the price-bearing paragraphs (hook lead-in if it
     *  mentions a number, "The deal at a glance" section, closing CTA),
     *  and UPDATES the existing WP post in place. Keeps the same URL,
     *  the same SEO juice, all 3 images, and the rest of the body
     *  untouched. ~15s + cheap. */
    refreshPriceId?: string
    /** Schedule path: ISO 8601 timestamp at which WordPress should
     *  flip the post from 'future' → 'publish'. Generation still runs
     *  immediately so the article + images are ready well before the
     *  deal goes live; WP's native cron handles the timed publish at
     *  exactly this moment. Must be at least 60s in the future.
     *
     *  Used by the CSV-driven deals queue: the deal's start_datetime
     *  becomes the post's scheduled_at, so the post lands the moment
     *  the deal opens. */
    scheduledAt?: string
  }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Bad request' }, { status: 400 }) }

  // ─── Refresh-price short-circuit ──────────────────────────────────────
  // Runs before the rest of the body parsing because it doesn't need
  // url/asin/promoCode/etc. — it loads everything from the saved row.
  if (typeof body.refreshPriceId === 'string' && body.refreshPriceId.trim()) {
    return refreshDealPrice(supabase, user.id, tier, body.refreshPriceId.trim())
  }

  // Regenerate replay: load the old row's deal_meta and overwrite the body
  // fields with whatever was originally used. Server-side reconstruction
  // (rather than client-side) keeps promoCode/promoUrl out of the GET
  // response payload — they only need to leave the DB when we're using
  // them again.
  let regenerateOldRow: { id: string; wpPostId: number | null; wpSiteId: string | null } | null = null
  if (typeof body.regenerateId === 'string' && body.regenerateId.trim()) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: oldRow } = await (supabase as any)
      .from('blog_posts')
      .select('id, wordpress_post_id, wordpress_site_id, deal_meta, post_type')
      .eq('id', body.regenerateId.trim())
      .eq('user_id', user.id)
      .maybeSingle()
    if (!oldRow) return NextResponse.json({ error: 'Deal to regenerate not found.', code: 'not_found' }, { status: 404 })
    if (oldRow.post_type !== 'deal') return NextResponse.json({ error: 'That row isn\'t a deal post.', code: 'wrong_type' }, { status: 400 })
    const oldMeta = (oldRow.deal_meta || {}) as Record<string, unknown>
    if (!oldMeta.asin) {
      return NextResponse.json({
        error: 'This deal was created before regenerate was supported (no saved ASIN). Delete it and re-paste the product link.',
        code: 'no_meta',
      }, { status: 400 })
    }
    body.asin = oldMeta.asin as string
    body.promoCode = (oldMeta.promoCode as string | null) || ''
    body.promoUrl = (oldMeta.promoUrl as string | null) || ''
    body.occasion = (oldMeta.occasion as DealOccasionSlug) || 'auto'
    body.manualDealEnd = (oldMeta.dealEndsAt as string | null) || ''
    body.preview = false // regenerate ALWAYS publishes — no preview step
    regenerateOldRow = {
      id: oldRow.id as string,
      wpPostId: (oldRow.wordpress_post_id as number | null) || null,
      wpSiteId: (oldRow.wordpress_site_id as string | null) || null,
    }
  }

  const rawInput = (body.url || body.asin || '').trim()
  const asin = await asinFromInput(rawInput)
  if (!asin) {
    // Tailored message: distinguish "I gave you junk" from "I gave you a
    // link we couldn't unwrap to an Amazon listing".
    const looksLikeUrl = /^https?:\/\//i.test(rawInput)
    const errorMsg = looksLikeUrl
      ? 'That link doesn\'t resolve to an Amazon product page. The Deals Hub reads Amazon listings for pricing, so paste the Amazon URL directly, an Amazon short link (amzn.to / a.co), or a Geniuslink that points to Amazon.'
      : 'Paste a product link or a 10-character Amazon ASIN.'
    return NextResponse.json({
      error: errorMsg,
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

  // Schedule path: parse + validate the requested timestamp once so the
  // WP create call + the DB write share the same ISO. Falls through to
  // null when not scheduling (immediate publish, the default).
  let scheduledAtIso: string | null = null
  if (typeof body.scheduledAt === 'string' && body.scheduledAt.trim()) {
    const when = new Date(body.scheduledAt)
    if (isNaN(when.getTime())) {
      return NextResponse.json({
        error: 'scheduledAt is not a valid ISO timestamp.',
        code: 'bad_scheduled_at',
      }, { status: 400 })
    }
    if (when.getTime() <= Date.now() + 60_000) {
      // Minimum 60s in the future so WP's cron actually picks it up
      // BEFORE we mark the row as scheduled (immediate publishes should
      // use the no-scheduledAt path).
      return NextResponse.json({
        error: 'scheduledAt must be at least 60 seconds in the future. Use the immediate Generate flow for now-or-soon posts.',
        code: 'scheduled_too_soon',
      }, { status: 400 })
    }
    scheduledAtIso = when.toISOString()
  }

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
    // When the post is scheduled to publish at the deal's actual start
    // time, we don't need to tell the writer "this deal opens Tuesday"
    // — by the time anyone reads the article, the deal IS open. So we
    // pass null here, even when scheduledAtIso is set. The hook reads
    // as a fresh "this deal is live" piece either way.
    scheduledStartIso: null,
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
  // the FAQ/closer. Also appends the [mvp_deal_cta] big-button shortcode
  // at the END so even when the writer's inline CTA gets stripped, the
  // post still ships with a prominent buy button.
  const finalHtml = injectBodyImages({
    html,
    images: uploadedBody,
    productTitle: product.title || 'this product',
    occasionLabel: occasion.longLabel,
    badgeLabel,
    promoCode,
    promoUrl,
    dealEndsAt,
    asin: product.asin,
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
    // When scheduledAtIso is set we use WP's native future-publish:
    // status='future' + date=<ISO>. WordPress's own cron flips the post
    // from future → publish at that timestamp. No new cron on our side,
    // no risk of an AI service being down at deal-start because the
    // article + images are already baked into the post.
    wpPost = await wpService.createPost({
      title: wpTitle,
      slug,
      content: finalHtml,
      excerpt: buildExcerpt({ product, badgeLabel, savingsLine, occasionLong: occasion.longLabel }),
      ...(scheduledAtIso
        ? { status: 'future' as const, date: scheduledAtIso }
        : { status: 'publish' as const }),
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
  // Deals never have a source video by definition. video_id is nullable
  // on blog_posts, and Postgres treats NULL as distinct under the
  // (user_id, video_id) unique constraint, so multiple null-video deals
  // per user are allowed.
  //
  // The earlier "fall back to most-recent video_id" hack was a leftover
  // from when video_id was NOT NULL. With nullable video_id, the
  // fallback was actively HARMFUL — it kept colliding with the existing
  // review row that owned that video_id, hitting the
  // blog_posts_user_id_video_id_key unique constraint on every deal
  // insert. Result: first deal failed, every subsequent deal failed
  // identically, the WP posts piled up un-tracked.
  const fallbackVideoId: string | null = null

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
    // Scheduled timestamp (ISO) so the UI can show "Publishes in 3 days"
    // and so the GET endpoint surfaces it on the Recent Deals list.
    scheduledAt: scheduledAtIso,
  }

  // Insert the row. Resilient to missing migration 093:
  //   - First try with deal_meta (full path).
  //   - If that errors with a "column does not exist" / deal_meta-related
  //     message, retry WITHOUT deal_meta. The WP post is already live, so
  //     leaving the user without a DB row would orphan the WP post and
  //     break Recent Deals. We keep their post and surface the migration
  //     hint via the response body.
  //   - Surfaces the actual error in the response if both fail so the
  //     user doesn't get a false success while their post is orphaned.
  // Scheduled posts get status='scheduled' so the Library's Scheduled
  // tab + the dashboard counters separate them from live-published rows.
  // published_at is set anyway (to scheduledAtIso) so the dashboard's
  // "this period" counts use a consistent timestamp.
  const baseRow = {
    user_id: user.id,
    video_id: fallbackVideoId,
    title: wpTitle,
    slug,
    content: finalHtml,
    excerpt: null,
    wordpress_post_id: wpPost.id,
    wordpress_url: wpPost.link,
    wordpress_site_id: site.site_id,
    status: scheduledAtIso ? 'scheduled' : 'published',
    post_type: 'deal',
    seo_keyword: product.title || `deal-${asin}`,
    published_at: scheduledAtIso ?? new Date().toISOString(),
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let saved: any = null
  let migrationNeeded: string | null = null
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const firstInsert = await (supabase as any)
    .from('blog_posts')
    .insert({ ...baseRow, deal_meta: dealMeta })
    .select('id')
    .single()
  if (firstInsert.error) {
    const msg = String(firstInsert.error?.message || '')
    const details = String((firstInsert.error as { details?: string })?.details || '')
    const hint = String((firstInsert.error as { hint?: string })?.hint || '')
    const code = String(firstInsert.error?.code || '')
    console.error('[deals POST] insert with deal_meta failed:', firstInsert.error)
    // Detect missing migration 093 from any field Postgres / Supabase
    // might surface it on: message, code (42703), details, or hint. The
    // earlier check only looked at message + code, which silently missed
    // the case where Supabase wraps the column-missing error and puts the
    // identifier in `details` instead.
    if (/deal_meta/i.test(msg) || /column .* does not exist/i.test(msg) || /deal_meta/i.test(details) || /deal_meta/i.test(hint) || code === '42703') {
      migrationNeeded = '093_blog_posts_deal_meta'
      // Retry without deal_meta. The deal post still lives, the user just
      // loses the meta-driven pills on the Recent Deals row until they
      // run migration 093.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const fallback = await (supabase as any)
        .from('blog_posts')
        .insert(baseRow)
        .select('id')
        .single()
      if (fallback.error) {
        console.error('[deals POST] fallback insert (no deal_meta) failed:', fallback.error)
        return NextResponse.json({
          error: `Couldn't save the deal post to the database (the WP post was published but isn't tracked yet). Run migration 093 in Supabase SQL editor and try again. DB error: ${fallback.error.message}`,
          code: 'insert_failed',
          wpPostId: wpPost.id,
          wpUrl: wpPost.link,
        }, { status: 500 })
      }
      saved = fallback.data
    } else {
      return NextResponse.json({
        error: `Couldn't save the deal post to the database (the WP post was published but isn't tracked yet). DB error: ${msg}`,
        code: 'insert_failed',
        wpPostId: wpPost.id,
        wpUrl: wpPost.link,
      }, { status: 500 })
    }
  } else {
    saved = firstInsert.data
  }

  // ── Regenerate cleanup ────────────────────────────────────────────────
  // Now that the new post is safely published + the new row is in the DB,
  // delete the old WP post + DB row. Best-effort: a stuck WP delete still
  // lets the new post live — leaving an old row around is worse than the
  // duplicate WP post.
  if (regenerateOldRow) {
    if (regenerateOldRow.wpPostId) {
      try {
        const oldSite = await getWordPressCredentials(supabase, user.id, regenerateOldRow.wpSiteId)
        if (oldSite) {
          const oldWp = createWordPressService(
            oldSite.wordpress_url,
            oldSite.wordpress_username,
            oldSite.wordpress_app_password,
            oldSite.wordpress_api_token || undefined,
          )
          await oldWp.deletePost(regenerateOldRow.wpPostId)
        }
      } catch (err) {
        console.warn('[deals regenerate] old WP delete failed:', err instanceof Error ? err.message : err)
      }
    }
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (supabase as any)
        .from('blog_posts')
        .delete()
        .eq('id', regenerateOldRow.id)
        .eq('user_id', user.id)
    } catch (err) {
      console.warn('[deals regenerate] old DB row delete failed:', err instanceof Error ? err.message : err)
    }
  }

  return NextResponse.json({
    ok: true,
    postId: saved?.id ?? null,
    wpPostId: wpPost.id,
    url: wpPost.link,
    title: wpTitle,
    regenerated: !!regenerateOldRow,
    replacedPostId: regenerateOldRow?.id ?? null,
    ...(migrationNeeded ? { migrationNeeded } : {}),
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
  /** Reserved for future "this deal opens in X" hook framing when WP
   *  publishes well ahead of the deal start. Currently null because
   *  every scheduled post lands AT the deal start (WP's `status=future`
   *  + `date` fires at exactly the scheduled time), so by the time
   *  readers see the article the deal is live. Field kept for
   *  forward-compat if we add a "drop early as a teaser" mode. */
  scheduledStartIso?: string | null
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

  // Amazon Renewed has a mandatory disclosure: the buyer is getting a
  // refurbished unit, not new. Burying that detail = bait-and-switch at
  // checkout, which violates our no-deception standard. Force the writer
  // to surface it in the hook AND in "Before you buy".
  const renewedDisclosure = p.occasion === 'renewed'
    ? `\nMANDATORY RENEWED DISCLOSURE: This is an Amazon Renewed listing — the unit is professionally inspected and refurbished, NOT brand-new. The article MUST surface this fact:\n  - In the opening hook (one short sentence acknowledging refurbished status, e.g. "It's the Renewed version, professionally inspected and refurbished, not new — and that's exactly why it costs less.")\n  - In "Before you buy" (a sentence explaining the Amazon Renewed 90-day guarantee + what "refurbished" actually means here)\nDo NOT frame this like a regular deal. Buyers should know what they're getting before they click.`
    : ''

  const fallbackUrl = `https://www.amazon.com/dp/${p.product.asin}`
  const promoLine = (() => {
    const lines: string[] = []
    if (p.promoCode) lines.push(`Promo code: ${p.promoCode}. Use this in the deal-box CTA copy.`)
    if (p.promoUrl) lines.push(`Special promo URL: ${p.promoUrl}. Every "buy" / "see deal" anchor in the article should link to this URL.`)
    if (!lines.length) lines.push(`No promo code or special URL given. Use the Amazon canonical URL ${fallbackUrl} as the href on every CTA anchor.`)
    return lines.join(' ')
  })()
  const ctaHref = p.promoUrl || fallbackUrl

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
- ${promoLine}${renewedDisclosure}

${DEAL_VOICE_RULES}

STRUCTURE (target ~800 words):
1. <p> Punchy opening hook. State the deal up front: what's discounted, by how much (if known), and why it matters TODAY. If the occasion is set, lean into it ("Prime Day delivered a real one this year:"). Two sentences max for the hook.
2. <h2>The deal at a glance</h2> — One <p> with the price story (was vs. now if known, ${p.savingsLine ? 'savings: ' + p.savingsLine : 'no explicit discount, frame as "this price is the floor I\'ve seen recently"'}), then the expiration note if any, then a one-line CTA. Wrap the CTA anchor as <a href="${ctaHref}" rel="nofollow sponsored">${p.promoCode ? `Apply code ${p.promoCode} on Amazon` : 'See the deal on Amazon'}</a>.
3. <h2>Why this deal is worth your attention</h2> — 2-3 paragraphs. Confident, direct product commentary. Use the spec bullets above as known facts about the product, not as something you're citing ("The 6500 RPM motor handles X" — NOT "the listing claims a 6500 RPM motor"). Talk about who this fits and who it doesn't. Never claim hands-on time. Never cite the listing as a source.
4. <h2>What you're actually getting</h2> — Bullet list <ul><li> of 4-6 concrete specs / features. Concise. State them directly. No marketing fluff. No "the listing says" framing.
5. <h2>Before you buy</h2> — One <p> of grounded caveats: shipping windows for the occasion, return policy considerations, the kinds of buyer this would NOT fit. Keep it real.
6. <p> Final CTA paragraph: occasion-aware nudge + a clean one-line outro that ends with a single anchor to the deal. Anchor href is the same as step 2.

VOICE / STYLE
- First person throughout. Match how ${p.reviewerName} writes.
- Contractions everywhere (it's, you'll, I've, can't).
- Short blunt sentences mixed with longer ones.
- ABSOLUTE BAN on em-dashes (—) and en-dashes (–). EVERYWHERE. Use a comma, a period, or parentheses.
- Never use "honest" or any variant. Never: moreover, furthermore, additionally, in conclusion, to summarize, overall, delve, tapestry, elevate, utilize, game-changer, revolutionary, cutting-edge, genuinely, actually, it's important to.
- HARD BAN on source-citing language. NEVER say: "based on the listing", "the listing says/claims/describes/shows/notes/is clearly aimed", "looking at the listing", "per the listing", "according to the spec sheet", "based on the spec sheet", "from the listing", "Amazon's listing", "the product page says". Just state product facts directly, the way a magazine editor would. If you catch yourself reaching for one of these phrases, REWRITE the sentence to lead with the product itself.
- Vary sentence openings. Don't start three paragraphs in a row the same way.
- NEVER invent specs, prices, dates, or features. Only state what's actually known.
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
  asin: string
}

/** Splice the WP-uploaded body images into the HTML at sensible H2
 *  boundaries, wrap the post in a [mvp_deal_banner] shortcode at the top,
 *  and append the [mvp_deal_cta] big-button shortcode at the bottom so the
 *  post always ships with a prominent buy button.
 *
 *  URL fallback: when the user didn't supply a promo URL, every link
 *  defaults to amazon.com/dp/<ASIN> (the canonical product page, NOT the
 *  generic amazon.com homepage we used before — that was a dead link the
 *  user spotted). Geniuslink/Amaffsoft on the WP side wraps it on the way
 *  out, so affiliate tracking still works without code changes. */
function injectBodyImages(opts: InjectBodyImagesOpts): string {
  let out = opts.html
  const fallbackUrl = `https://www.amazon.com/dp/${opts.asin}`
  const effectiveUrl = opts.promoUrl || fallbackUrl

  // 1. Substitute any leftover placeholder anchors with the resolved URL.
  // The prompt now passes the URL inline, so this is belt-and-braces.
  if (out.includes('PLACEHOLDER_DEAL_URL')) {
    out = out.replace(/PLACEHOLDER_DEAL_URL/g, effectiveUrl)
  }
  // Also catch the legacy "https://www.amazon.com" bare fallback (no /dp/)
  // that older prompt versions emitted — we want every anchor to point at
  // the actual product, not the homepage.
  out = out.replace(/href="https:\/\/www\.amazon\.com\/?"/g, `href="${effectiveUrl}"`)

  // 2. Insert body images after H2 #1 and H2 #3 if we have them.
  if (opts.images.length > 0) {
    const altText = (i: number) => `${opts.productTitle} ${opts.occasionLabel} deal image ${i + 1}`
    const h2Indices: number[] = []
    const re = /<h2\b[^>]*>[\s\S]*?<\/h2>/gi
    let m: RegExpExecArray | null
    while ((m = re.exec(out)) !== null) {
      h2Indices.push(m.index + m[0].length)
    }
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

  // 3. Prepend the deal banner shortcode (top of post). Always pass `url`
  // and (when ASIN is known) the canonical fallback as a backup so the
  // banner's CTA always has somewhere to point. Plugin renders countdown
  // / "Deal ended" client-side; if the plugin isn't installed yet the
  // shortcode prints literally — user updates the plugin once and every
  // existing deal post lights up.
  const bannerAtts: string[] = []
  if (opts.dealEndsAt) bannerAtts.push(`end_date="${escapeAttr(opts.dealEndsAt)}"`)
  if (opts.badgeLabel) bannerAtts.push(`badge="${escapeAttr(opts.badgeLabel)}"`)
  if (opts.promoCode) bannerAtts.push(`code="${escapeAttr(opts.promoCode)}"`)
  // ALWAYS pass a URL — the banner CTA is the post's primary buy button.
  bannerAtts.push(`url="${escapeAttr(effectiveUrl)}"`)
  out = `\n[mvp_deal_banner ${bannerAtts.join(' ')}]\n\n` + out

  // 4. Append the end-of-article CTA shortcode. This is the "proper buy
  // button at the end" — a standalone, full-width violet button that
  // matches the banner's styling so readers who scrolled past the top
  // banner still hit a clear path to the deal.
  const ctaAtts: string[] = []
  ctaAtts.push(`url="${escapeAttr(effectiveUrl)}"`)
  if (opts.promoCode) ctaAtts.push(`code="${escapeAttr(opts.promoCode)}"`)
  if (opts.badgeLabel) ctaAtts.push(`badge="${escapeAttr(opts.badgeLabel)}"`)
  out = out + `\n\n[mvp_deal_cta ${ctaAtts.join(' ')}]\n`

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
  // Amazon titles frequently contain en-dashes ("Trimmer – Weed Wacker
  // Battery..."), which sneak into the excerpt because the title is the
  // raw scraped string. Run scrubEmDashes so the excerpt + WP title
  // honour the em-dash ban end-to-end.
  const cleanTitle = scrubEmDashes(opts.product.title || 'this product')
  const lead = opts.savingsLine
    ? `${opts.savingsLine} on ${cleanTitle}.`
    : `Price-watch alert on ${cleanTitle}.`
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
  // En-dash scrub here too — Amazon listings carry them constantly and the
  // ban applies in the WP post title (which shows on archive pages, in
  // search results, in social shares, everywhere).
  const base = scrubEmDashes(opts.product.title || `Deal on ASIN ${opts.product.asin}`)
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

// ─── Refresh-price flow ────────────────────────────────────────────────────
//
// Cheap cousin of Regenerate. The full Regenerate runs the writer + 3 image
// renders + image uploads + WP create (~$0.25 + 45s). Refresh Price keeps
// the WP post in place (same URL, same SEO, same comments + backlinks),
// keeps the existing images entirely, and runs a single Sonnet patch pass
// that updates ONLY the price-bearing sentences. Roughly $0.02 + 15s.
//
// What the patch pass updates:
//   - The [mvp_deal_banner] shortcode atts at the top (badge, end_date,
//     code, url) — replaced verbatim with the new values.
//   - The [mvp_deal_cta] shortcode atts at the bottom — same deal.
//   - In the prose: any price numbers, savings amounts, percent-off
//     phrases, and "save while it lasts" / "while the price holds"
//     style framing. Sonnet is told to preserve sentence boundaries +
//     paragraph structure + image placeholders.
//
// What survives untouched:
//   - The product image (featured + body)
//   - Every spec, bullet, and "Why this deal" / "What you're actually
//     getting" / "Before you buy" paragraph
//   - The slug + title + WP post id
//   - The reviewer attribution

async function refreshDealPrice(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  userId: string,
  tier: string,
  rowId: string,
): Promise<NextResponse> {
  // 1. Load the row + its content + meta
  const { data: row } = await supabase
    .from('blog_posts')
    .select('id, title, slug, content, wordpress_post_id, wordpress_site_id, deal_meta, post_type')
    .eq('id', rowId)
    .eq('user_id', userId)
    .maybeSingle()

  if (!row) return NextResponse.json({ error: 'Deal not found.', code: 'not_found' }, { status: 404 })
  if (row.post_type !== 'deal') return NextResponse.json({ error: 'That row isn\'t a deal post.', code: 'wrong_type' }, { status: 400 })
  const oldMeta = (row.deal_meta || {}) as Record<string, unknown>
  const asin = oldMeta.asin as string | undefined
  if (!asin) {
    return NextResponse.json({
      error: 'This deal was created before refresh-price was supported (no saved ASIN). Regenerate it instead.',
      code: 'no_meta',
    }, { status: 400 })
  }
  const oldContent = (row.content as string | null) || ''
  if (!oldContent || oldContent.length < 200) {
    return NextResponse.json({ error: 'Deal content missing or too short to refresh. Regenerate it instead.', code: 'bad_content' }, { status: 400 })
  }

  // 2. Re-scrape the product. Surface Amazon block errors clearly so the
  //    user can retry — we never silently update with stale data.
  let product: AmazonProduct
  try {
    product = await fetchAmazonProduct(asin)
  } catch (err) {
    return NextResponse.json({
      error: `Couldn't read the Amazon listing: ${err instanceof Error ? err.message : 'unknown error'}. Try again in a minute.`,
      code: 'amazon_block',
    }, { status: 502 })
  }

  // 3. Compute new deal envelope. Re-use the same occasion + promo from
  //    the original row — refresh-price is about UPDATING THE NUMBERS, not
  //    changing the deal framing.
  const occasionSlug = (oldMeta.occasion as DealOccasionSlug) || 'none'
  const occasion = getOccasion(occasionSlug)
  const dealEndsAt = (oldMeta.dealEndsAt as string | null) || product.dealEndsAt || null
  const promoCode = ((oldMeta.promoCode as string | null) || '').trim()
  const promoUrl = ((oldMeta.promoUrl as string | null) || '').trim()

  const newBadgeLabel = pickBadgeLabel({
    occasionSlug,
    priceWas: product.priceWas,
    priceSale: product.priceSale ?? product.price,
    discountPct: product.discountPct,
  })
  const newSavingsLine = computeSavingsLine({
    priceWas: product.priceWas,
    priceSale: product.priceSale ?? product.price,
    discountPct: product.discountPct,
  })

  // 4. Strip the existing top + bottom shortcodes so the Sonnet patch
  //    pass sees only article body. We re-inject fresh ones afterwards.
  let articleBody = oldContent
  articleBody = articleBody.replace(/\[mvp_deal_banner\b[^\]]*\]\s*/i, '').trim()
  articleBody = articleBody.replace(/\[mvp_deal_cta\b[^\]]*\]\s*/i, '').trim()

  // 5. Sonnet patch pass: rewrite ONLY the price-bearing sentences.
  const client = createAnthropicClient()
  const fallbackUrl = `https://www.amazon.com/dp/${product.asin}`
  const ctaHref = promoUrl || fallbackUrl

  const patchPrompt = `You are updating an existing deal-post article with REFRESHED pricing data. Update ONLY the price-related sentences — leave every other paragraph identical (same words, same order, same image tags, same headings, same anchor structure).

CURRENT (stale) ARTICLE:
\`\`\`html
${articleBody}
\`\`\`

NEW PRICING DATA (use these numbers, ignore whatever is in the article today):
- Current sale price: ${product.priceSale ?? product.price ?? 'unknown'}
- Strike-through "was" price: ${product.priceWas ?? 'unknown'}
- Savings line: ${newSavingsLine ?? 'no explicit discount detected on the listing right now'}
- Discount percent: ${product.discountPct != null ? product.discountPct + '%' : 'unknown'}
- Amazon deal badge text on the listing: ${product.dealBadge ?? 'none'}
- Deal end date: ${dealEndsAt ?? 'not specified'}
- CTA href to use on every anchor: ${ctaHref}
- Promo code (use in CTA copy if present): ${promoCode || 'none'}

WHAT TO UPDATE:
- ANY sentence that mentions a dollar amount, percent off, savings, "was X now Y", or price comparison.
- The "Deal at a glance" h2 section paragraph — rewrite to reflect the new prices + savings + (if known) end date.
- The opening hook if it cites a savings number.
- The closing CTA paragraph if it cites a number.
- Every <a href="..."> in the article — update to ${ctaHref}.

WHAT TO PRESERVE (do not touch):
- All <h2>, <ul>, <li>, <figure>, <img> tags + their attributes.
- The "Why this deal is worth your attention" section in full.
- The "What you're actually getting" bullet list in full.
- The "Before you buy" section in full (unless it mentions a dollar amount).
- Paragraph order + paragraph count.
- Reviewer voice + tone.

VOICE RULES (still apply):
- First person. Confident product knowledge.
- NEVER say "based on the listing", "the listing says/shows/claims/describes/is clearly", "looking at the listing", "per the listing", "according to the spec sheet". Just state the new prices directly.
- ABSOLUTE BAN on em-dashes (—) and en-dashes (–). Use commas, periods, or parentheses.
- No "honest" or any variant. No moreover, furthermore, additionally, in conclusion, overall, delve, tapestry, elevate, utilize, game-changer, revolutionary, cutting-edge, genuinely, actually, it's important to.

OUTPUT: VALID HTML only. No markdown fences. Same structure as the input — just with refreshed price-bearing sentences and updated anchor hrefs.`

  let newBody = ''
  try {
    const msg = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 5000,
      messages: [{ role: 'user', content: patchPrompt }],
    })
    recordAnthropicUsage(msg, { userId, tier, feature: 'deal_refresh_price', model: 'claude-sonnet-4-6' })
    const raw = (msg.content[0] as { type: string; text: string })?.text || ''
    newBody = scrubDealHtml(raw)
  } catch (err) {
    return NextResponse.json({ error: `Refresh failed: ${err instanceof Error ? err.message : 'unknown'}` }, { status: 500 })
  }
  if (!newBody || newBody.length < 400) {
    return NextResponse.json({ error: 'Refresh returned empty body.' }, { status: 500 })
  }

  // 6. Re-inject the deal banner + end-of-article CTA with NEW atts.
  const bannerAtts: string[] = []
  if (dealEndsAt) bannerAtts.push(`end_date="${escapeAttr(dealEndsAt)}"`)
  if (newBadgeLabel) bannerAtts.push(`badge="${escapeAttr(newBadgeLabel)}"`)
  if (promoCode) bannerAtts.push(`code="${escapeAttr(promoCode)}"`)
  bannerAtts.push(`url="${escapeAttr(ctaHref)}"`)

  const ctaAtts: string[] = []
  ctaAtts.push(`url="${escapeAttr(ctaHref)}"`)
  if (promoCode) ctaAtts.push(`code="${escapeAttr(promoCode)}"`)
  if (newBadgeLabel) ctaAtts.push(`badge="${escapeAttr(newBadgeLabel)}"`)

  const finalHtml = `[mvp_deal_banner ${bannerAtts.join(' ')}]\n\n${newBody}\n\n[mvp_deal_cta ${ctaAtts.join(' ')}]`

  // 7. UPDATE the WP post in place. Different from regenerate which
  //    creates a new post — we keep the same URL, same id, same SEO.
  const site = await getWordPressCredentials(supabase, userId, (row.wordpress_site_id as string | null) || null)
  if (!site) {
    return NextResponse.json({ error: 'WordPress credentials not found. Reconnect your site in Setup.', code: 'no_wp' }, { status: 400 })
  }
  const wpService = createWordPressService(
    site.wordpress_url,
    site.wordpress_username,
    site.wordpress_app_password,
    site.wordpress_api_token || undefined,
  )

  const wpPostId = row.wordpress_post_id as number | null
  if (!wpPostId) {
    return NextResponse.json({ error: 'WordPress post id missing on row — try Regenerate instead.', code: 'no_wp_post' }, { status: 400 })
  }
  try {
    await wpService.updatePost(wpPostId, {
      content: finalHtml,
      // Title and slug stay the same — refresh-price is about updating
      // the numbers, not the URL or the page metadata.
    })
  } catch (err) {
    if (isStalePostError(err)) return NextResponse.json({ error: WP_STALE_POST_MESSAGE, code: 'wp_post_deleted' }, { status: 410 })
    return NextResponse.json({ error: err instanceof Error ? err.message : 'WordPress update failed' }, { status: 500 })
  }

  // 8. Update the DB row. content + a fresh deal_meta with new prices.
  const newMeta = {
    ...oldMeta,
    priceWas: product.priceWas,
    priceSale: product.priceSale ?? product.price,
    discountPct: product.discountPct,
    dealBadge: product.dealBadge,
    dealEndsAt,
    badgeLabel: newBadgeLabel,
    savingsLine: newSavingsLine,
    lastPriceRefreshAt: new Date().toISOString(),
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (supabase as any)
    .from('blog_posts')
    .update({ content: finalHtml, deal_meta: newMeta })
    .eq('id', row.id)
    .eq('user_id', userId)

  return NextResponse.json({
    ok: true,
    refreshed: true,
    postId: row.id,
    wpPostId,
    url: null, // we don't have a guaranteed WP link from updatePost; client refetches the list to get it
    title: row.title,
    newPrice: product.priceSale ?? product.price,
    newSavings: newSavingsLine,
  })
}
