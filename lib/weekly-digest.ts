// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// Weekly Deal Digest engine (Phase 2 of the Keepa content loop). Picks the best
// verified deals in a creator's niche from the shared deal_radar_cache and
// assembles a roundup blog post. The cron (app/api/cron/weekly-deal-digest)
// orchestrates per-user publishing; this lib holds the reusable pieces so the
// logic is testable and the cron stays thin.

import { createGeniuslinkService } from '@/services/geniuslink'
import { createAdminClient } from '@/lib/supabase/admin'
import { passportLinkForUser } from '@/lib/passport-links'
import { getLinkStyle, type LinkStyleConfig } from '@/lib/link-cloak'
import { shortenBitly } from '@/lib/bitly'
import { scrubBanned } from '@/lib/scrub'
import { getThumbnailFaceRef } from '@/lib/identity-anchor'
import { rehostAll, composeWithNanoBananaPro, composeWithNanoBanana } from '@/lib/thumbnail-generators'
import { recordUsage } from '@/lib/ai-usage'

export interface DigestDealRow {
  asin: string
  title: string
  brand: string | null
  image_url: string | null
  price_now_cents: number | null
  price_was_cents: number | null
  discount_pct: number | null
  deal_quality: string | null
  lowest_label: string | null
}

export interface DigestDeal extends DigestDealRow {
  /** Resolved affiliate URL (tag, Geniuslink-wrapped when configured). */
  affiliateUrl: string
}

const money = (c: number | null) => (c == null ? null : `$${(c / 100).toFixed(2)}`)

/**
 * Pick the top verified deals for a creator's niches from deal_radar_cache.
 * Only "real" deals (price history confirms a genuine discount) so a digest
 * never recommends a fake markdown. Matches niches by full-text search over
 * title+brand; falls back to the best verified deals overall when there's no
 * niche or too few matches. Returns up to `limit` rows, biggest discount first.
 */
export async function pickDigestDeals(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: any,
  niches: string[],
  limit = 5,
): Promise<DigestDealRow[]> {
  const cols = 'asin,title,brand,image_url,price_now_cents,price_was_cents,discount_pct,deal_quality,lowest_label'
  const verified = ['excellent', 'genuine']

  const terms = niches.map((n) => (n || '').trim()).filter(Boolean).slice(0, 6)
  if (terms.length) {
    // websearch OR across the niche terms, so "Home & Kitchen" + "Sleep" widen
    // rather than narrow the match.
    const query = terms.map((t) => t.replace(/[^a-z0-9 ]/gi, ' ').trim()).filter(Boolean).join(' OR ')
    if (query) {
      const { data } = await admin.from('deal_radar_cache').select(cols)
        .textSearch('fts', query, { type: 'websearch', config: 'english' })
        .in('deal_quality', verified)
        .order('discount_pct', { ascending: false, nullsFirst: false })
        .limit(limit)
      const rows = (data ?? []) as DigestDealRow[]
      if (rows.length >= 3) return rows
    }
  }

  // Fallback: best verified deals overall.
  const { data } = await admin.from('deal_radar_cache').select(cols)
    .in('deal_quality', verified)
    .order('discount_pct', { ascending: false, nullsFirst: false })
    .limit(limit)
  return (data ?? []) as DigestDealRow[]
}

/**
 * Resolve a product's affiliate URL: the creator's Amazon tag, wrapped through
 * Geniuslink when configured (retry once, then fall back to the tagged link so
 * it always earns). Shared shape with the deal-post resolver.
 */
export async function resolveAffiliateUrl(
  asin: string, title: string,
  amazonTag: string | null, gKey: string | null, gSecret: string | null,
  userId?: string | null,
  // Pre-resolved style, so a caller looping over many items for the SAME user
  // reads getLinkStyle once and passes it in (avoids an integrations read per
  // item). Omit for a one-off call and it's read from userId.
  config?: LinkStyleConfig,
): Promise<string> {
  const tagged = amazonTag
    ? `https://www.amazon.com/dp/${asin}?tag=${encodeURIComponent(amazonTag)}`
    : `https://www.amazon.com/dp/${asin}`

  // Wrap `tagged` in the creator's Geniuslink (default group, retry once), or
  // return `tagged` when there are no keys. Kept as a helper so the style switch
  // below and the no-user legacy path share exactly one implementation.
  const geniusOrTagged = async (key: string | null, secret: string | null): Promise<string> => {
    if (!key || !secret) return tagged
    const genius = createGeniuslinkService(key, secret)
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const wrapped = await genius.createLink(tagged, title.slice(0, 120) || `Deal ${asin}`)
        if (wrapped && /^https?:\/\//i.test(wrapped)) return wrapped
      } catch (err) {
        console.warn(`[weekly-digest] geniuslink wrap failed for ${asin} (attempt ${attempt}):`, err instanceof Error ? err.message : err)
      }
      if (attempt < 2) await new Promise((r) => setTimeout(r, 1200))
    }
    return tagged
  }

  // No user context (rare) → legacy behavior: Geniuslink if keys, else tagged.
  if (!userId) return geniusOrTagged(gKey, gSecret)

  // With a user, honor their ONE chosen link style so digest/roundup links match
  // the rest of MVP: Passport (geo-route) / Bitly / Geniuslink / Direct.
  const cfg = config ?? (await getLinkStyle(createAdminClient(), userId))
  switch (cfg.style) {
    case 'passport': {
      try {
        const p = await passportLinkForUser(createAdminClient(), userId, asin, { source: 'blog', title })
        if (p) return p
      } catch { /* fall through to tagged */ }
      return tagged
    }
    case 'bitly': {
      if (!cfg.bitlyToken) return tagged
      const short = await shortenBitly(cfg.bitlyToken, tagged)
      return short || tagged
    }
    case 'geniuslink':
      return geniusOrTagged(gKey || cfg.geniuslinkKey, gSecret || cfg.geniuslinkSecret)
    default:
      return tagged
  }
}

interface DigestModelOut { title?: string; theme?: string; intro: string; blurbs: Record<string, string>; outro: string }

const titleCase = (s: string) => s.replace(/\b\w/g, (c) => c.toUpperCase())

/**
 * Generate the digest's title, theme, and prose (intro, a blurb per deal, outro)
 * with Haiku as JSON, then assemble the full post HTML deterministically so
 * structure/links are never left to the model. Returns { title, html, excerpt,
 * theme }.
 *
 * The title + theme are derived from the ACTUAL products in the list (their
 * common thread), NOT the blog's niche — a hand-picked roundup can span or
 * differ from the creator's usual niche, so `nicheLabel` is only a soft hint.
 * `theme` is a short category used for the slug + WordPress category.
 *
 * NEVER names a data provider (Keepa etc.) — prices are "the product's own price
 * history". The FTC disclosure + SEO polish are added by the caller via
 * applyPostFixes, so they're consistent with the rest of the site.
 */
export async function generateDigestContent(opts: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  client: any
  deals: DigestDeal[]
  reviewerName: string
  nicheLabel: string
  monthYear: string
  /** Retailer these deals are on ("Amazon" default, or "Walmart"). */
  retailer?: string
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  recordUsage?: (msg: any) => void
}): Promise<{ title: string; html: string; excerpt: string; theme: string }> {
  const { client, deals, reviewerName, nicheLabel } = opts
  const retailer = opts.retailer || 'Amazon'

  const dealLines = deals.map((d, i) => {
    const price = money(d.price_now_cents)
    const ctx = d.lowest_label ? ` Price context: ${d.lowest_label}.` : ''
    const disc = d.discount_pct != null ? ` ~${d.discount_pct}% off.` : ''
    return `${i + 1}. [${d.asin}] ${d.title}${price ? ` — now ${price}.` : ''}${disc}${ctx}`
  }).join('\n')

  let model: DigestModelOut = { intro: '', blurbs: {}, outro: '' }
  try {
    const msg = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1000,
      messages: [{
        role: 'user',
        content: `You are ${reviewerName}, writing a hand-picked roundup of the best ${retailer} deals for your affiliate review blog.
Your blog usually covers "${nicheLabel}", but only lean on that if these SPECIFIC products fit it — otherwise describe what is ACTUALLY in this list.

DEALS (in order):
${dealLines}

Return ONLY valid JSON, no markdown fence, shaped exactly:
{"title": "...", "theme": "...", "intro": "...", "blurbs": {"<ASIN>": "...", ...}, "outro": "..."}

Rules:
- "title": a ROUNDUP title for the WHOLE set, naming the shared category, never a single product or brand. Good examples: "This Week's Best Kitchen Deals", "Weekly Home & Tech Deals", "This Week's Top Pet Finds". Under 55 characters. Title Case. NEVER put a year or date in the title. No single product names, no provider names, no clickbait, no dashes.
- "theme": 1 to 3 plain lowercase words naming the product category these share, for the URL and site category (e.g. "kitchen", "home office", "pet supplies", "tech"). If they are a genuine mix, use "deals".
- "intro": 2 sentences. Answer-first — say this is your hand-picked roundup of genuine price drops worth a look. First person.
- "blurbs": one entry per ASIN above. 2 short sentences each: what it is + why THIS price is worth grabbing now. Present the price context as fact from the product's own price history. NEVER name any data provider, tool, or service (no "Keepa", "price tracker", "our data"). Never claim you personally tested it.
- "outro": 1 sentence close, a light nudge to grab them before prices bounce back.
- Plain text values (no HTML). No em-dashes or en-dashes anywhere. No "honest", "moreover", "furthermore", "game-changer".` }],
    })
    opts.recordUsage?.(msg)
    const raw = (msg.content?.[0] as { type: string; text: string })?.text || ''
    const jsonStr = raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1)
    model = JSON.parse(jsonStr) as DigestModelOut
  } catch (err) {
    console.warn('[weekly-digest] model content failed, using fallback prose:', err instanceof Error ? err.message : err)
  }

  // Theme (for slug + WP category) and title come from the actual products.
  const themeClean = scrubBanned((model.theme || '').trim()).replace(/[^a-z0-9 &-]/gi, '').replace(/\s+/g, ' ').trim()
  const theme = (themeClean || nicheLabel || 'deals').slice(0, 40)
  const modelTitle = scrubBanned((model.title || '').trim()).replace(/^["']|["']$/g, '')
  // Roundup fallback — a clear "this week's deals" title, never a single product
  // and never a year/date stamp in the title itself.
  const themeWord = theme && theme.toLowerCase() !== 'deals' ? `${titleCase(theme)} ` : ''
  const fallbackTitle = scrubBanned(`This Week's Best ${themeWord}Deals`).slice(0, 60)
  const title = modelTitle.length >= 8 && modelTitle.length <= 70 ? modelTitle : fallbackTitle

  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  const intro = scrubBanned(model.intro || `Here are the ${nicheLabel.toLowerCase()} deals I'd actually grab this week — each one checked against its price history so you're not paying a fake discount.`)
  const outro = scrubBanned(model.outro || `Prices like these don't tend to stick around, so grab what you want before they climb back up.`)

  const sections = deals.map((d) => {
    const blurb = scrubBanned(model.blurbs?.[d.asin] || `${d.title} is at a genuinely strong price right now.`)
    const price = money(d.price_now_cents)
    const was = money(d.price_was_cents)
    const priceLine = price
      ? `<p><strong>${price}</strong>${was && (d.price_was_cents ?? 0) > (d.price_now_cents ?? 0) ? ` <span style="text-decoration:line-through;color:#888">${was}</span>` : ''}${d.discount_pct != null ? ` · about ${d.discount_pct}% off` : ''}</p>`
      : ''
    const img = d.image_url
      ? `<figure class="mvp-deal-image"><img src="${esc(d.image_url)}" alt="${esc(d.title).slice(0, 120)}" loading="lazy" /></figure>`
      : ''
    return `<h2>${esc(d.title).slice(0, 120)}</h2>\n${img}\n${priceLine}\n<p>${esc(blurb)}</p>\n<p><a href="${esc(d.affiliateUrl)}" rel="nofollow sponsored">See the deal on ${esc(retailer)}</a></p>`
  }).join('\n\n')

  const html = `<p>${esc(intro)}</p>\n\n${sections}\n\n<p>${esc(outro)}</p>`
  const excerpt = intro.slice(0, 160)
  return { title, html, excerpt, theme }
}

/** Human niche label for the title, from the creator's niches. */
export function nicheLabelFrom(niches: string[]): string {
  const first = (niches || []).map((n) => (n || '').trim()).filter(Boolean)[0]
  return first || 'Amazon'
}

// Words that add no SEO value in a slug — dropped so the URL stays keyword-first.
const SLUG_STOPWORDS = new Set([
  'a', 'an', 'the', 'this', 'that', 'these', 'those', 'and', 'or', 'but', 'for',
  'to', 'of', 'in', 'on', 'at', 'by', 'with', 'your', 'you', 'my', 'our', 'we',
  'i', 'is', 'are', 'it', 'its', 'worth', 'grabbing', 'right', 'now', 'get',
  'week', 'weekly',
])

/**
 * Build a clean, keyword-centric slug from the post title (never a random hash
 * or a generic "roundup-…"/"weekly-…" prefix). Keeps the meaningful keywords,
 * drops stopwords, caps length. WordPress de-dupes collisions with a numeric
 * suffix, so we don't need to inject one ourselves. Falls back to the theme.
 */
export function keywordSlug(title: string, theme: string): string {
  const clean = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim()
  const words = clean(title || '').split(' ').filter(Boolean)
  const kept = words.filter((w) => !SLUG_STOPWORDS.has(w))
  const pick = (kept.length >= 3 ? kept : words).slice(0, 7)
  const slug = pick.join('-')
  if (slug.length >= 3) return slug.slice(0, 70).replace(/-+$/g, '')
  const themeSlug = clean(theme || 'deals').replace(/\s+/g, '-')
  return `best-${themeSlug || 'amazon'}-deals`
}

/**
 * Build a branded "WEEKLY DEALS" thumbnail featuring the creator's face, so the
 * roundup post leads with an on-brand cover instead of a random product photo.
 * Best-effort: returns null when the creator has no ready face model or the
 * compose fails, so the cron falls back to the lead product image. Bounded cost
 * (one image per user per week).
 */
export async function buildDigestThumbnail(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  opts: { userId: string; tier?: string | null; leadImageUrl?: string | null; theme?: string | null },
): Promise<string | null> {
  try {
    // A ready face model with source selfies is required for the face.
    const { data: fms } = await supabase
      .from('face_models').select('id,source_images,status').eq('user_id', opts.userId)
    // We only need the raw selfies to build the identity anchor — the model does
    // NOT have to be fully "ready" (trained). So use any face that has selfies on
    // file, preferring a ready one. Maximizes how many creators get the cover.
    const asStrArr = (v: unknown): string[] => Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
    const withSelfies = ((fms as Array<{ id: string; source_images: unknown; status: string }> | null) || [])
      .map(m => ({ id: m.id, source_images: asStrArr(m.source_images), status: m.status }))
      .filter(m => m.source_images.length > 0)
    const face = withSelfies.find(m => m.status === 'ready') || withSelfies[0]
    if (!face) return null

    const faceRef = await getThumbnailFaceRef(supabase, opts.userId, {
      faceId: face.id, sourceImages: face.source_images, expression: 'excited', tier: opts.tier ?? null,
    })
    if (!faceRef) return null

    const refs = await rehostAll([faceRef, ...(opts.leadImageUrl ? [opts.leadImageUrl] : [])])
    if (refs.length === 0) return null

    const themeWord = opts.theme && opts.theme.toLowerCase() !== 'deals' ? ` ${opts.theme.toUpperCase()}` : ''
    const prompt = `Design a bold, high-contrast YouTube-style thumbnail (16:9) for a WEEKLY DEALS roundup.
FEATURE THE PERSON from the FIRST reference image — preserve their exact face and likeness — on one side, looking excited and pointing toward the deals. Do NOT invent a different person.
Bake in LARGE, perfectly spelled headline text reading exactly "WEEKLY${themeWord} DEALS" with a smaller "PRICE DROPS" tag.
Include a few tidy product boxes / price-tag graphics on the other side (use the product reference if provided). Bright, punchy, modern, saturated colours, clean composition. No watermark, no extra sentences.`

    let imgs = await composeWithNanoBananaPro({ prompt, referenceImageUrls: refs, aspectRatio: '16:9', numImages: 1 })
    let model = 'nano-banana-pro'
    if (!imgs[0]) { imgs = await composeWithNanoBanana({ prompt, referenceImageUrls: refs, aspectRatio: '16:9', numImages: 1 }); model = 'nano-banana' }
    if (!imgs[0]) return null

    recordUsage({ userId: opts.userId, tier: opts.tier ?? null, feature: 'weekly_digest_thumbnail', model, images: 1 })
    return imgs[0]
  } catch (err) {
    console.warn('[weekly-digest] branded thumbnail failed:', err instanceof Error ? err.message : String(err))
    return null
  }
}
