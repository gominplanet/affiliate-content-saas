/**
 * POST /api/blog/from-link — generate a full review blog post from a product
 * link / ASIN (no video required). The "non-YouTube" entry into the content
 * engine: paste an Amazon ASIN/URL or any store/affiliate link, optionally a
 * product name + angle, and MVP researches the product (the link + name + web/
 * owner sentiment), writes an SEO/AI-optimized review in the creator's voice
 * with MVP's rules + citation guards (no transcript to ground on, so research
 * IS the grounding), recloaks the link via Geniuslink when configured,
 * generates a hero/featured image, publishes to WordPress, and saves a normal
 * blog_posts row (post_type 'review', no video) so it lives in Posts and is
 * schedulable / social-pushable like any other post.
 *
 * Mirrors the proven app/api/blog/comparison flow (resolve → research → write →
 * recloak → hero → publish → guard → insert), single-product variant.
 *
 * Body: { link?, productName?, angle?, category?, includeImages?, siteId? }
 * Available on all paid tiers; counts as ONE post (postsPerMonth) + spend gate.
 */
import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { createAnthropicClient } from '@/lib/anthropic'
import { deriveProductName } from '@/lib/product-name'
import { toUserMessage } from '@/lib/friendly-error'
import { createClaudeService } from '@/services/claude'
import { createWordPressService } from '@/services/wordpress'
import { resolveFinalUrl } from '@/lib/product-link'
import { createGeniuslinkService } from '@/services/geniuslink'
import { fetchAmazonProduct, extractAsin } from '@/services/amazon'
import { researchProductFromUrl, researchProductByWebSearch, fetchProductImageFromPage } from '@/services/research'
import { checkUsageLimit, checkGenerationLimit, normalizeTier } from '@/lib/tier'
import { scrubBanned, BANNED_RULE } from '@/lib/scrub'
import { learnProfileToPrompt } from '@/lib/learn'
import { recordUsage, usageFromAnthropic } from '@/lib/ai-usage'
import { pingIndexNowForUrl } from '@/lib/seo-on-publish'
import { NO_BRAND_IMAGE_CLAUSE } from '@/lib/image-guard'
import { getWordPressCredentials } from '@/lib/wordpress-sites'
import { passportLinkForUser } from '@/lib/passport-links'
import { getLinkStyle } from '@/lib/link-cloak'
import { shortenBitly } from '@/lib/bitly'
import { getAuthAndOwner } from '@/lib/agency-auth'
import { spendGate } from '@/lib/ai-spend'
import { freeTierGenerationBlock } from '@/lib/free-tier-gate'
import { fal } from '@fal-ai/client'

export const runtime = 'nodejs'
export const maxDuration = 300

const slugify = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80)

// Derive a product name from a store URL's slug when we have nothing else — most
// stores put the product name right in the path (Walmart /ip/<slug>/<id>, Amazon
// /<slug>/dp/<asin>, Shopify /products/<slug>, Target /p/<slug>/-/A-<id>, …). This
// is what lets a Walmart/Target/etc. link work even though those sites block
// server-side scraping: we get the real product name, then web-research grounds it.
function nameFromUrl(url: string): string {
  try {
    const u = new URL(url)
    const GENERIC = new Set(['ip', 'dp', 'p', 'gp', 'product', 'products', 'item', 'itm', 'pd', 'shop', 'buy', 'a', 'dp-monetized'])
    const seg = u.pathname.split('/').filter(Boolean)
      // Skip generic path words and pure ID segments (numbers, A-1234, B0XXXX…).
      .filter(s => !GENERIC.has(s.toLowerCase()) && !/^[A-Z0-9]{8,}$/i.test(s) && !/^\d+$/.test(s))
      // The product slug is the one with the most words.
      .sort((a, b) => b.split(/[-_]/).length - a.split(/[-_]/).length)[0] || ''
    let name = decodeURIComponent(seg).replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim()
    // Drop trailing size/pack noise that bloats the name (e.g. "16 9floz 1 69floz").
    name = name.replace(/\b\d+(\.\d+)?\s?(fl ?oz|oz|ml|l|ct|count|pack|pk|g|kg|lb|lbs|in|inch|cm)\b/gi, '').replace(/\s+/g, ' ').trim()
    if (name.split(' ').length < 2 || name.length < 4) return ''
    return name.slice(0, 120)
  } catch { return '' }
}

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

// Guarantee the affiliate link is hyperlinked inline at least `min` times in
// the prose (matches the main blog writer's "affiliate link 3+ times" rule —
// services/claude/index.ts). The from-link writer only emits CTA buttons, so
// we weave contextual links into the body deterministically: wrap natural
// product-name mentions in an anchor, one per text run, skipping any text
// already inside an <a>. Caps at `min` so we never over-link.
function ensureInlineAffiliateLinks(html: string, url: string, productName: string, min = 3): string {
  if (!url || !productName) return html
  const name = productName.split(/[,(\-–|]/)[0].trim()
  if (name.length < 3) return html
  const existing = (html.match(new RegExp(`href="${escapeRegExp(url)}"`, 'g')) || []).length
  let needed = min - existing
  if (needed <= 0) return html
  const nameRe = new RegExp(`\\b${escapeRegExp(name)}\\b`, 'i')
  const anchor = (m: string) => `<a href="${url}" target="_blank" rel="nofollow sponsored noopener">${m}</a>`
  let inAnchor = 0
  const tokens = html.split(/(<[^>]+>)/)
  for (let i = 0; i < tokens.length && needed > 0; i++) {
    const t = tokens[i]
    if (t.startsWith('<')) {
      if (/^<a\b/i.test(t)) inAnchor++
      else if (/^<\/a\s*>/i.test(t)) inAnchor = Math.max(0, inAnchor - 1)
      continue
    }
    if (inAnchor > 0 || !nameRe.test(t)) continue
    tokens[i] = t.replace(nameRe, anchor) // one mention per text run — no clustering
    needed--
  }
  return tokens.join('')
}

// Shorteners/cloakers we resolve to a final URL before extracting an ASIN.
const CLOAK_RE = /(?:geni\.us|amzn\.to|a\.co|bit\.ly|tinyurl\.com|rebrand\.ly|fkbms\.|lddy\.no|shrsl\.|sovrn\.|go\.magik)/i

export async function POST(req: Request) {
  const supabase = await createServerClient()
  const auth = await getAuthAndOwner(supabase)
  if ('error' in auth) return auth.error
  const { user, ownerId } = auth

  let body: {
    link?: string; productName?: string; angle?: string; category?: string; includeImages?: boolean; siteId?: string
    // Product data SCOUT scraped off a non-Amazon store page in the user's own
    // browser (Walmart/Target/etc. block our server scrape). Best-effort grounding.
    scraped?: { title?: string; description?: string; bullets?: string[]; brand?: string | null; price?: string | null; rating?: string | null; imageUrl?: string | null; images?: string[]; sourceUrl?: string }
  }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Bad request' }, { status: 400 }) }

  const link = (body.link || '').trim()
  const providedName = (body.productName || '').trim()
  const angle = (body.angle || '').trim()
  const category = (body.category || '').trim()
  const siteId = body.siteId
  if (!link && !providedName) {
    return NextResponse.json({ error: 'Paste a product link or ASIN — or at least the product name.' }, { status: 400 })
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: wp } = await supabase
    .from('integrations')
    .select('tier,geniuslink_api_key,geniuslink_api_secret,amazon_associates_tag')
    .eq('user_id', ownerId)
    .maybeSingle()
  const tier = normalizeTier(wp?.tier)

  // Free plan: require a connected YouTube channel + WordPress site before any
  // generation (qualification bar / abuse control). Paid tiers pass instantly.
  const freeBlock = await freeTierGenerationBlock(supabase, ownerId, tier)
  if (freeBlock) return NextResponse.json({ error: freeBlock, code: 'connect_required', currentTier: tier }, { status: 403 })

  // Spend circuit breaker (Sonnet writer + hero image).
  const spendBlocked = await spendGate(ownerId, tier)
  if (spendBlocked) return spendBlocked

  const site = await getWordPressCredentials(supabase, ownerId, siteId)
  if (!site) return NextResponse.json({ error: 'Connect your WordPress site first (Set Up → WordPress).' }, { status: 400 })

  // One review = one content piece against the cap (trial lifetime + monthly pool).
  const usage = await checkUsageLimit(supabase, user.id)
  if (!usage.allowed) {
    return NextResponse.json({ error: usage.reason, limitReached: true, cap: 'posts', currentTier: usage.tier, upgrade: usage.upgrade }, { status: 429 })
  }
  const gen = await checkGenerationLimit(supabase, user.id)
  if (!gen.allowed) {
    return NextResponse.json({ error: gen.reason, limitReached: true, cap: 'generations', currentTier: gen.tier, upgrade: gen.upgrade }, { status: 429 })
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: brand } = await supabase
    .from('brand_profiles')
    .select('*')
    .eq('user_id', ownerId)
    .maybeSingle()
  const learnBlock = learnProfileToPrompt(brand?.learn_profile)
  const disclaimer = (brand?.affiliate_disclaimer as string) ||
    '📌 As an Amazon Associate I earn from qualifying purchases. This post contains affiliate links — I may earn a small commission at no extra cost to you.'

  // ── Content preferences — parity with video-to-blog (Brand Profile →
  //    Content). Each section toggle defaults ON (only an explicit false hides
  //    it), matching services/claude so both entry points read the same way. ──
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const b = (brand || {}) as Record<string, any>
  const lengthMap: Record<string, string> = {
    short: '600–900 words', medium: '900–1,500 words',
    long: '1,500–2,500 words', deep: '2,500–3,200 words',
  }
  const targetLength = lengthMap[b.post_length as string] || '900–1,500 words'
  const ctaStyleMap: Record<string, string> = {
    hard_sell: 'Be direct and persuasive about buying — clear "buy this" energy, urgency is fine.',
    soft_recommendation: 'Recommend warmly but low-pressure — "here’s why I liked it, worth a look".',
    informational: 'Stay neutral and informational — let the facts sell it, no pushy language.',
  }
  const ctaGuidance = ctaStyleMap[b.cta_style as string] || ctaStyleMap.soft_recommendation
  const wantVerdict   = b.include_quick_verdict !== false
  const wantProsCons  = b.include_pros_cons !== false
  const wantScorecard = b.include_scorecard !== false
  const wantFaq       = b.include_faq !== false

  const ctx = { userId: user.id, tier }
  // The creator's ONE chosen Link style. Geniuslink only when they picked it;
  // Bitly wraps the tagged fallback when that's their style; Passport calls
  // below self-gate (passportLinkForUser returns null unless it's their style).
  const flStyle = await getLinkStyle(supabase, ownerId)
  const genius = (flStyle.style === 'geniuslink' && wp?.geniuslink_api_key && wp?.geniuslink_api_secret)
    ? createGeniuslinkService(wp.geniuslink_api_key, wp.geniuslink_api_secret)
    : null
  const flBitly = async (url: string): Promise<string> => {
    if (flStyle.style !== 'bitly' || !flStyle.bitlyToken) return url
    const short = await shortenBitly(flStyle.bitlyToken, url)
    return short || url
  }

  // ── 1. Resolve the source: ASIN (Amazon) or any store/affiliate link ────────
  let finalUrl = link
  if (link && CLOAK_RE.test(link)) {
    try { finalUrl = await resolveFinalUrl(link) } catch { finalUrl = link }
  }
  const asin = link ? (extractAsin(finalUrl) || extractAsin(link)) : null

  let productName = providedName
  let pDescription = ''
  let bullets: string[] = []
  let affiliateUrl: string | null = null
  // A real product photo, used as the featured-image fallback when the
  // generated hero is unavailable — so every post still gets a thumbnail.
  let productImageUrl: string | null = null

  if (asin) {
    try {
      const p = await fetchAmazonProduct(asin)
      if (p.title) productName = providedName || p.title
      pDescription = p.description || ''
      bullets = p.bullets || []
      productImageUrl = p.imageUrl || p.images?.[0] || null
    } catch { /* fall back to research / provided name */ }
    // Passport Links (geo-routing) wins WHEN ON; else Geniuslink, else tag.
    const passport = await passportLinkForUser(supabase, ownerId, asin, { source: 'blog', title: productName || 'product' })
    if (passport) affiliateUrl = passport
    if (!affiliateUrl && genius) {
      try { affiliateUrl = (await genius.createAsinLinkWithCode(asin, productName || 'product')).url } catch { /* ignore */ }
    }
    if (!affiliateUrl) {
      affiliateUrl = await flBitly(wp?.amazon_associates_tag
        ? `https://www.amazon.com/dp/${asin}?tag=${wp.amazon_associates_tag}`
        : `https://www.amazon.com/dp/${asin}`)
    }
  } else if (link) {
    // Non-Amazon store/affiliate link — cloak it per the creator's style:
    // Geniuslink wrap (geo-routing + analytics), Bitly shorten, or leave the
    // user's own link as-is (Direct/Passport). The user's link is the
    // destination, so existing tracking is preserved; falls back to it on any
    // hiccup so a link is never lost.
    affiliateUrl = link
    if (genius) {
      try {
        const wrapped = await genius.createLink(link, productName || 'product')
        if (wrapped) affiliateUrl = wrapped
      } catch { /* keep the user's own link */ }
    } else {
      affiliateUrl = await flBitly(link)
    }
  }
  // SCOUT read the store page in the user's own browser — the real grounding for
  // stores that block our server scrape. Fill gaps only: a user-typed name and
  // Amazon catalog data still win. This gives us a real title, description,
  // feature bullets and product photo where the server had nothing.
  const scraped = (body.scraped && typeof body.scraped === 'object') ? body.scraped : null
  if (scraped) {
    const st = typeof scraped.title === 'string' ? scraped.title.trim() : ''
    if (st && !providedName && productName === providedName) productName = st
    if (!pDescription && typeof scraped.description === 'string') pDescription = scraped.description.trim().slice(0, 1600)
    if (bullets.length === 0 && Array.isArray(scraped.bullets)) {
      bullets = scraped.bullets.filter((b): b is string => typeof b === 'string' && b.trim().length > 0).slice(0, 10)
    }
    if (!productImageUrl && typeof scraped.imageUrl === 'string' && /^https?:\/\//.test(scraped.imageUrl)) {
      productImageUrl = scraped.imageUrl
    }
  }

  // If Amazon didn't resolve it and the user didn't type a name, read the name
  // from the store URL's slug — the key to making Walmart/Target/etc. links work
  // (those block server scraping, but the URL still carries the product name).
  const derivedName = (!providedName && productName === providedName)
    ? nameFromUrl(finalUrl || link || '')
    : ''
  if (!productName) productName = providedName || derivedName || 'this product'

  // ── 2. Research grounding (web + owner sentiment) — replaces the transcript ──
  let research = ''
  try {
    const target = finalUrl || link || providedName
    if (target) {
      const r = await researchProductFromUrl(target, productName, ctx)
      if (typeof r === 'string') research = r
    }
  } catch { /* research is best-effort */ }

  // If the direct page fetch came back thin or empty — which is exactly what
  // happens on Walmart, Target and most stores that block server-side scraping —
  // research the product BY NAME with live web search instead (specs, reviews,
  // comparisons from the open web). We have a real name from the URL slug, so
  // this is where the actual grounding comes from for non-Amazon links.
  const hasName = !!(productName && productName !== 'this product')
  if (research.trim().length < 200 && hasName) {
    try {
      const r = await researchProductByWebSearch(productName, finalUrl || link || '', ctx)
      if (typeof r === 'string' && !/NO_PRODUCT_INFO/i.test(r) && r.trim().length > research.trim().length) {
        research = r
      }
    } catch { /* best-effort */ }
  }

  if (!pDescription && !research && bullets.length === 0 && !providedName && !derivedName) {
    return NextResponse.json({ error: 'Couldn’t find enough about that product. Add the product name or a clearer link and try again.' }, { status: 422 })
  }

  // Non-Amazon: pull the product/brand page's og:image as a featured-image
  // fallback (Amazon already gave us a catalog photo above).
  if (!productImageUrl && (finalUrl || link)) {
    try { productImageUrl = await fetchProductImageFromPage(finalUrl || link) } catch { /* best-effort */ }
  }

  // ── 3. Write the review (single product, grounded, MVP rules + voice) ───────
  // Distil the messy Amazon title into a clean, searchable name. Shoppers query
  // AI/Google with BRAND + a short core name, so we thread that canonical name
  // through the title, H1, first mention and SEO keyword — and keep the raw
  // full title for ONE exact-match mention (long-tail search).
  const pn = deriveProductName(productName, (scraped?.brand as string | null | undefined) ?? null)
  const anthropic = createAnthropicClient()
  const sys = `You are the creator writing a FIRST-PERSON ("I"/"we") affiliate review of ONE product — you personally recommend it. Never write in third person or refer to "the reviewer". Only state facts present in the PRODUCT DATA or RESEARCH below — NEVER invent specs, numbers, prices, test results, or personal anecdotes you cannot support from that data. If first-hand detail is thin, write only at the level the data supports rather than fabricating. Lead each section answer-first. ${BANNED_RULE}\n${learnBlock}`

  const userPrompt = `Write a complete, SEO- and AI-Overview-optimized affiliate review blog post about ONE product.
${angle ? `ANGLE / FOCUS: ${angle}\n` : ''}${category ? `CATEGORY: ${category}\n` : ''}
PRODUCT
- Canonical name (USE THIS as the product's name everywhere): ${pn.canonical || productName}
- Brand: ${pn.brand || 'n/a'}
- Full listing title (for ONE exact mention only): ${pn.fullTitle || productName}
- Marketing description: ${(pDescription || '').slice(0, 800) || 'n/a'}
- Key features: ${bullets.slice(0, 8).join(' · ') || 'n/a'}

PRODUCT-NAME RULES (customers search the exact brand + product name, so match it):
- TITLE: must contain the canonical name "${pn.canonical || productName}" plus a short angle (e.g. "Review", "Worth It?"). Keep it under ~65 characters. Do NOT stuff the long marketing tail into the title.
- H1 + first mention: use the FULL canonical name once, in the opening sentence.
- After that: refer to it naturally with shorter forms (the brand, "this ${pn.shortName ? pn.shortName.split(' ').slice(-2).join(' ') : 'product'}") so it reads human, not keyword-stuffed.
- Include the FULL listing title verbatim EXACTLY ONCE in the body (a specs sentence or beside the buy button) for exact-match search — never in the flowing prose.
- Never write the brand as "<Brand> Store"; the brand is just "${pn.brand || productName}".

RESEARCH (web + real owner sentiment — ground real-world pros/cons and use cases here; for any specific number, spec, or claim, only include it if it appears in this data):
${(research || '').slice(0, 3500) || 'n/a'}

LENGTH: write the body at ${targetLength}.
CTA STYLE: ${ctaGuidance}

Return ONLY valid JSON (no markdown fences) with this exact shape:
{
  "title": "<= 65 char SEO title that INCLUDES the canonical product name above + a short angle, no banned words",
  "meta_description": "150-160 char compelling meta description that leads with the canonical product name, no banned words",
  "target_keyword": "the canonical product name (brand + short name)",
  "category": "a single concise blog category for this product/service, Title Case, 1-3 words (e.g. 'VPNs & Security', 'Headphones', 'Kitchen'); never the word 'blog'",
  "hero_prompt": "one vivid sentence describing an editorial, text-free HERO photo of this product's CATEGORY — clean, aspirational, magazine-style (no people required, no logos, no text)",
  "intro_html": "1-2 short intro paragraphs as raw HTML <p>...</p> (first person, answer-first hook)",
  "body_html": "${targetLength} as raw HTML <p>/<h2>/<ul><li> blocks. Real benefits, who it's for, how it's used, set-up, and trade-offs — specific and grounded, answer-first under each H2. Refer to the product by its name naturally several times across the body. No fabricated claims, no banned words."${wantProsCons ? `,
  "pros": ["3-5 concrete pros grounded in the data"],
  "cons": ["2-3 real drawbacks/limitations grounded in the data (every product has trade-offs)"]` : ''}${wantVerdict ? `,
  "verdict": "one punchy bottom-line sentence"` : ''}${wantScorecard ? `,
  "scorecard": [ { "label": "a rating dimension (e.g. Build quality, Value, Ease of use)", "score": 4.5 } ]  // 3-5 dimensions, each score 1-5 grounded in the data` : ''}${wantFaq ? `,
  "faq": [ { "q": "buyer question", "a": "answer-first 2-4 sentence answer" } ]  // 4-5 FAQs` : ''}
}`

  let parsed: {
    title: string; meta_description: string; target_keyword?: string; hero_prompt?: string
    category?: string
    intro_html: string; body_html: string; pros?: string[]; cons?: string[]; verdict?: string
    scorecard?: Array<{ label: string; score: number }>
    faq?: Array<{ q: string; a: string }>
  }
  try {
    const msg = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 8000,
      system: sys,
      messages: [{ role: 'user', content: userPrompt }],
    })
    recordUsage({ ...usageFromAnthropic(msg), userId: user.id, tier, feature: 'from_link_post', model: 'claude-sonnet-4-6' })
    const raw = (msg.content[0] as { type: string; text: string }).text
    const j = raw.match(/\{[\s\S]*\}/)
    parsed = JSON.parse(j?.[0] ?? raw)
  } catch (err) {
    console.error('[blog/from-link] writing', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: toUserMessage(err, 'Couldn’t write the post just now. Please try again in a moment.') }, { status: 502 })
  }

  // Weave the affiliate link inline through the prose — at least 3 contextual
  // hyperlinks on natural product mentions (the writer only emits CTA buttons).
  // Done BEFORE assembly so the links pass through the citation guards, which
  // are instructed to preserve every hyperlink.
  if (affiliateUrl) {
    parsed.intro_html = ensureInlineAffiliateLinks(parsed.intro_html || '', affiliateUrl, productName, 1)
    parsed.body_html = ensureInlineAffiliateLinks(parsed.body_html || '', affiliateUrl, productName, 3)
  }

  // ── 4. Assemble the WordPress (Gutenberg) HTML ──────────────────────────────
  // Pass the proxy secret (4th arg) so writes take the header-safe proxy path.
  // Omitting it forced the legacy Basic-Auth/nonce path, which fails to publish
  // on header-stripping hosts (Hostinger LiteSpeed / WAF) after the AI cost was
  // already billed — every other write route passes this.
  const wpService = createWordPressService(site.wordpress_url ?? '', site.wordpress_username ?? '', site.wordpress_app_password ?? '', site.wordpress_api_token ?? undefined)
  const scrub = (s: string) => scrubBanned(s || '')
  // Enforce the canonical product name in the title (belt-and-braces on the
  // prompt): if the model's title dropped the brand AND the product's core
  // words, fall back to a clean "<canonical> Review". Keeps every review title
  // matching how shoppers search, without the keyword-stuffed tail.
  let title = scrub(parsed.title) || ''
  if (pn.canonical) {
    const lt = title.toLowerCase()
    const coreWords = pn.shortName.toLowerCase().split(/\s+/).filter(Boolean).slice(0, 2)
    const hasBrand = !!pn.brand && lt.includes(pn.brand.toLowerCase())
    const hasCore = coreWords.length > 0 && coreWords.every((w) => lt.includes(w))
    if (!title || !(hasBrand || hasCore)) title = `${pn.canonical} Review`
  }
  if (!title) title = `${productName} Review`
  // The product's canonical name is the primary keyword.
  if (pn.canonical) parsed.target_keyword = pn.canonical
  const slug = slugify(title)

  let bodyHtml = ''
  // Affiliate disclosure banner.
  bodyHtml += `<!-- wp:group {"style":{"color":{"background":"#fffbe6"},"spacing":{"padding":{"top":"16px","bottom":"16px","left":"20px","right":"20px"}},"border":{"left":{"color":"#FFC200","width":"4px"}}},"layout":{"type":"constrained"}} -->\n<div class="wp-block-group has-background" style="border-left-color:#FFC200;border-left-width:4px;background-color:#fffbe6;padding:16px 20px"><!-- wp:paragraph {"style":{"typography":{"fontSize":"13px"}}} --><p style="font-size:13px">${scrub(disclaimer)}</p><!-- /wp:paragraph --></div>\n<!-- /wp:group -->\n`
  bodyHtml += `${scrub(parsed.intro_html)}\n`

  // Top CTA button (if we have an affiliate link).
  const ctaButton = (label: string) => affiliateUrl
    ? `<!-- wp:buttons --><div class="wp-block-buttons"><!-- wp:button {"backgroundColor":"vivid-amber"} --><div class="wp-block-button"><a class="wp-block-button__link wp-element-button" href="${affiliateUrl}" target="_blank" rel="nofollow sponsored noopener">${scrub(label)}</a></div><!-- /wp:button --></div><!-- /wp:buttons -->\n`
    : ''
  bodyHtml += ctaButton(`Check price → ${(pn.canonical || productName).split(',')[0].slice(0, 45)}`)

  bodyHtml += `${scrub(parsed.body_html)}\n`

  // Pros / cons columns — honor the Pros & Cons toggle (Brand Profile → Content).
  const pros = wantProsCons ? (parsed.pros || []).filter(Boolean) : []
  const cons = wantProsCons ? (parsed.cons || []).filter(Boolean) : []
  if (pros.length || cons.length) {
    const li = (arr: string[]) => arr.map(x => `<li>${scrub(x)}</li>`).join('')
    const prosCol = pros.length ? `<!-- wp:column --><div class="wp-block-column"><!-- wp:paragraph --><p><strong>👍 Pros</strong></p><!-- /wp:paragraph --><!-- wp:list --><ul>${li(pros)}</ul><!-- /wp:list --></div><!-- /wp:column -->` : ''
    const consCol = cons.length ? `<!-- wp:column --><div class="wp-block-column"><!-- wp:paragraph --><p><strong>👎 Cons</strong></p><!-- /wp:paragraph --><!-- wp:list --><ul>${li(cons)}</ul><!-- /wp:list --></div><!-- /wp:column -->` : ''
    bodyHtml += `<!-- wp:columns --><div class="wp-block-columns">${prosCol}${consCol}</div><!-- /wp:columns -->\n`
  }
  // Scorecard — honor the Scorecard toggle. A compact ratings list with star bars.
  const scorecard = wantScorecard ? (parsed.scorecard || []).filter(s => s?.label && typeof s.score === 'number') : []
  if (scorecard.length) {
    const rows = scorecard.slice(0, 5).map(s => {
      const score = Math.max(1, Math.min(5, Number(s.score)))
      const full = Math.round(score)
      const stars = '★'.repeat(full) + '☆'.repeat(5 - full)
      return `<!-- wp:paragraph --><p><strong>${scrub(s.label)}</strong> — <span style="color:#f5a623;letter-spacing:2px">${stars}</span> ${score.toFixed(1)}/5</p><!-- /wp:paragraph -->`
    }).join('\n')
    bodyHtml += `<!-- wp:heading --><h2>The scorecard</h2><!-- /wp:heading -->\n${rows}\n`
  }
  // Quick verdict — honor the Quick Verdict toggle.
  if (wantVerdict && parsed.verdict) {
    bodyHtml += `<!-- wp:paragraph {"style":{"typography":{"fontStyle":"italic"}}} --><p><em>👉 ${scrub(parsed.verdict)}</em></p><!-- /wp:paragraph -->\n`
  }
  bodyHtml += ctaButton(`See it on the store →`)

  // FAQ — honor the FAQ toggle.
  if (wantFaq && Array.isArray(parsed.faq) && parsed.faq.length) {
    bodyHtml += `<!-- wp:heading --><h2>Frequently asked questions</h2><!-- /wp:heading -->\n`
    for (const f of parsed.faq) {
      if (!f?.q) continue
      bodyHtml += `<!-- wp:heading {"level":3} --><h3>${scrub(f.q)}</h3><!-- /wp:heading -->\n<!-- wp:paragraph --><p>${scrub(f.a)}</p><!-- /wp:paragraph -->\n`
    }
  }

  // ── 5. Hero / featured image (text-free, brand-free) ────────────────────────
  let featuredMedia: number | undefined
  try {
    if (process.env.FAL_KEY) {
      fal.config({ credentials: process.env.FAL_KEY })
      const heroPrompt = `${parsed.hero_prompt || `An editorial hero photo representing ${title}`}. Bright, aspirational, magazine-style editorial photography, clean composition, premium lighting, photorealistic. ${NO_BRAND_IMAGE_CLAUSE} No text, no words, no letters, no logos anywhere.`
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const r = await fal.subscribe('fal-ai/flux-pro/v1.1' as any, {
        input: { prompt: heroPrompt, image_size: 'landscape_16_9', num_inference_steps: 28, guidance_scale: 3.5, num_images: 1, output_format: 'jpeg', safety_tolerance: '2' },
        pollInterval: 3000,
      })
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const heroSrc = ((r.data as any)?.images as Array<{ url: string }> | undefined)?.[0]?.url ?? null
      if (heroSrc) {
        recordUsage({ userId: user.id, tier, feature: 'from_link_hero_image', model: 'fal-flux-pro-v1.1', images: 1 })
        const media = await wpService.uploadImageFromUrl(heroSrc, `${slug}-hero.jpg`)
        if (media?.id) featuredMedia = media.id
      }
    }
  } catch { /* publish without a generated hero — the product photo fallback below covers it */ }

  // Fallback: no generated hero (FAL_KEY unset or flux failed) → use the real
  // product/brand photo so EVERY post still ships with a featured thumbnail.
  if (!featuredMedia && productImageUrl) {
    try {
      const media = await wpService.uploadImageFromUrl(productImageUrl, `${slug}-product.jpg`)
      if (media?.id) featuredMedia = media.id
    } catch { /* publish without a featured image as a last resort */ }
  }

  // ── 6. JSON-LD (BlogPosting + FAQPage) ──────────────────────────────────────
  const siteBase = (site.wordpress_url || '').replace(/\/$/, '')
  const postUrl = `${siteBase}/${slug}/`
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const graph: any[] = [{
    '@type': 'BlogPosting',
    headline: title,
    description: scrub(parsed.meta_description),
    datePublished: new Date().toISOString(),
    mainEntityOfPage: postUrl,
    author: { '@type': 'Person', name: (brand?.author_name as string) || (brand?.name as string) || 'Editor' },
  }]
  if (Array.isArray(parsed.faq) && parsed.faq.length) {
    graph.push({
      '@type': 'FAQPage',
      mainEntity: parsed.faq.filter(f => f?.q).map(f => ({ '@type': 'Question', name: scrub(f.q), acceptedAnswer: { '@type': 'Answer', text: scrub(f.a) } })),
    })
  }
  const jsonld = JSON.stringify({ '@context': 'https://schema.org', '@graph': graph })

  // ── 7. Resolve the category (never "blog") ──────────────────────────────────
  // Priority: the category the user typed → the writer's suggestion → the
  // creator's first brand niche → a sensible default. Find-or-create in WP.
  const firstNiche = Array.isArray(brand?.niches) ? (brand?.niches as string[]).find(n => (n || '').trim()) : ''
  const rawCategory = (category || (parsed.category || '').trim() || (firstNiche || '').trim() || 'Reviews').trim()
  // Guard: an AI or user value of "blog"/"uncategorized" is exactly what we're
  // trying to avoid — fall back to Reviews.
  const categoryName = /^(blog|uncategorized|uncategorised)$/i.test(rawCategory) ? 'Reviews' : rawCategory.slice(0, 50)
  let categoryId: number | null = null
  try { categoryId = await wpService.createCategory(categoryName) } catch { /* publish uncategorized rather than fail */ }

  // ── 8. Publish to WordPress ─────────────────────────────────────────────────
  let wpPost
  try {
    wpPost = await wpService.createPost({
      title,
      content: bodyHtml,
      excerpt: scrub(parsed.meta_description),
      slug,
      status: 'publish',
      ...(featuredMedia ? { featured_media: featuredMedia } : {}),
      ...(categoryId ? { categories: [categoryId] } : {}),
      meta: { mvp_meta_description: scrub(parsed.meta_description), mvp_jsonld: jsonld },
    })
  } catch (err) {
    console.error('[blog/from-link] wp publish', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: toUserMessage(err, 'Couldn’t publish to WordPress just now. Please check your site connection and try again.') }, { status: 502 })
  }

  void pingIndexNowForUrl(supabase, ownerId, wpPost.link, siteId).catch(() => {})

  // ── 9. Hallucination guards (research is the source budget) ─────────────────
  let bodyAfterChecks = bodyHtml
  try {
    const claudeSvc = createClaudeService()
    const sourceResearch = `Product: ${productName}\nDescription: ${(pDescription || '').slice(0, 800)}\nBullets:\n${bullets.slice(0, 10).join('\n')}\n\nResearch:\n${(research || '').slice(0, 6000)}`.slice(0, 12000)
    try {
      const checked = await claudeSvc.factCheckAndGuard(bodyAfterChecks, '', sourceResearch, { userId: user.id, tier })
      if (checked && checked !== bodyAfterChecks) bodyAfterChecks = scrub(checked)
    } catch { /* non-fatal */ }
    if (bodyAfterChecks !== bodyHtml) {
      try { await wpService.updatePost(wpPost.id, { content: bodyAfterChecks }) } catch { /* keep prior text */ }
    }
  } catch { /* published post stands */ }

  // ── 10. Save the blog_posts row (no video; treated as a normal review) ──────
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (supabase as any).from('blog_posts').insert({
    user_id: ownerId,
    video_id: null,
    title,
    slug,
    content: bodyAfterChecks,
    excerpt: scrub(parsed.meta_description),
    status: 'published',
    post_type: 'review',
    wordpress_post_id: wpPost.id,
    wordpress_url: wpPost.link,
    ...(site.site_id !== 'legacy' ? { wordpress_site_id: site.site_id } : {}),
    ai_model: 'claude-sonnet-4-6',
    generation_prompt_version: 'from-link-v1',
    published_at: new Date().toISOString(),
  })

  return NextResponse.json({ ok: true, url: wpPost.link, postId: wpPost.id, title, targetKeyword: parsed.target_keyword ?? null })
}
