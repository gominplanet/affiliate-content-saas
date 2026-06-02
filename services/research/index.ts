// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential. No copying, redistribution, reverse-engineering, or reuse. See LICENSE.
import { createAnthropicClient } from '@/lib/anthropic'
import type { AmazonProduct } from '@/services/amazon'
import { recordUsage, usageFromAnthropic } from '@/lib/ai-usage'

/**
 * Web-research agent for the campaign content engine.
 *
 * Unlike the YouTube pipeline (substance comes from the video transcript),
 * a campaign post has no source material — so we research the open web.
 * Uses Claude Sonnet with the built-in `web_search` server tool (no extra
 * API key, Claude runs the searches + synthesizes in one call) to produce
 * a structured research brief: the questions buyers actually ask, the
 * problems the product solves, real objections/complaints, and how it
 * compares to alternatives.
 *
 * Returns a markdown brief (consumed by the blog prompt) plus the source
 * URLs Claude cited, so we can show provenance later if we want.
 */

export interface ResearchBrief {
  brief: string
  citations: string[]
}

export async function researchProduct(
  product: AmazonProduct,
  ctx?: { userId?: string | null; tier?: string | null },
): Promise<ResearchBrief> {
  const client = createAnthropicClient()

  const productContext = [
    `Product: ${product.title}`,
    product.price ? `Price: ${product.price}` : '',
    product.rating ? `Amazon rating: ${product.rating}` : '',
    product.bullets.length ? `Key features:\n${product.bullets.map(b => `- ${b}`).join('\n')}` : '',
    product.description ? `Description: ${product.description.slice(0, 800)}` : '',
  ].filter(Boolean).join('\n')

  const prompt = `You are a product research analyst preparing a brief for a buyer's-guide writer (an informational article, not a personal hands-on review).

Research this product thoroughly using web search. Run multiple searches — the product by name, "<product> review", "<product> problems", "<product> vs", "is <product> worth it", relevant Reddit / forum threads, and the underlying use-case or problem category.

${productContext}

Produce a RESEARCH BRIEF in markdown with exactly these sections:

## What buyers actually ask
8–12 real questions people ask before buying this (or this category). Phrase them the way a real shopper would search/ask. These become the FAQ.

## Problems it solves
The concrete pain points / frustrations this product addresses. Be specific about the "before" state — what's annoying/broken without it.

## Objections & complaints
Real downsides, common complaints, who it's NOT for. Pulled from reviews/forums, not invented. A trustworthy review acknowledges these.

## How it compares
The main alternatives buyers weigh it against and the practical trade-offs (price, durability, ease, etc.).

## Key facts worth citing
Specs, numbers, or claims found in research that strengthen the review's credibility.

Rules:
- Ground every section in what you actually found via search. If something is thin, say so rather than padding.
- No marketing fluff in the brief itself — it's an internal working document.
- Keep the whole brief under ~900 words.

Return ONLY the markdown brief.`

  const msg = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 4000,
    tools: [
      // Server-side web search tool — Claude runs the queries itself.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { type: 'web_search_20250305', name: 'web_search', max_uses: 6 } as any,
    ],
    messages: [{ role: 'user', content: prompt }],
  })

  {
    const u = usageFromAnthropic(msg)
    recordUsage({ userId: ctx?.userId, tier: ctx?.tier, feature: 'campaign_research', model: 'claude-sonnet-4-6', input: u.input, output: u.output, webSearches: u.webSearches })
  }

  // The response interleaves tool-use / search-result / text blocks. We want
  // the final synthesized text; concatenate any text blocks. Citation URLs
  // come from web_search_tool_result blocks.
  let brief = ''
  const citations = new Set<string>()
  for (const block of msg.content) {
    if (block.type === 'text') {
      brief += block.text
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const anyBlock = block as any
    if (anyBlock.type === 'web_search_tool_result' && Array.isArray(anyBlock.content)) {
      for (const r of anyBlock.content) {
        if (r?.url) citations.add(r.url)
      }
    }
  }

  brief = brief.trim()
  if (!brief) {
    throw new Error('Research agent returned no brief — web search may have failed')
  }

  return { brief, citations: Array.from(citations).slice(0, 20) }
}

/**
 * Fetch the product/brand page a creator linked in their YouTube
 * description and extract a factual product brief — the open-web
 * equivalent of an Amazon scrape. The transcript still drives the
 * voice; this just gives the writer accurate product facts when there's
 * no Amazon ASIN to scrape.
 *
 * Best-effort: returns '' on any failure (unreachable page, JS-only
 * site, extraction miss) so the caller falls back to transcript-only.
 */
export async function researchProductFromUrl(
  url: string,
  productHint: string,
  ctx?: { userId?: string | null; tier?: string | null },
): Promise<string> {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' },
      redirect: 'follow',
      // Don't let a slow/hanging product page block the generation pipeline.
      signal: AbortSignal.timeout(12000),
    })
    if (!res.ok) return ''
    const html = await res.text()
    // Strip scripts/styles/tags → readable text. Cap so we don't blow the
    // token budget on a bloated page.
    const text = html
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&[a-z]+;/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 12000)
    if (text.length < 200) return ''

    const client = createAnthropicClient()
    const msg = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 700,
      messages: [{
        role: 'user',
        content: `Below is the readable text scraped from a product page a creator linked. Extract a FACTUAL product brief the review writer can rely on — like a spec sheet, NOT marketing copy.

PRODUCT (from the video, for context): ${productHint || '(unknown)'}
SOURCE URL: ${url}

PAGE TEXT:
${text}

Return markdown with only what's actually supported by the page:
## Product
One line: what it is + who it's for.
## Key specs & features
Bullet list of concrete specs/features stated on the page (dimensions, materials, capacity, modes, compatibility, etc.).
## Price
If a price is shown, state it; else "not listed".
## Notable claims
Any standout manufacturer claims worth citing (warranty, certifications, performance numbers).

Rules: do NOT invent anything not on the page. If the page is thin or clearly not a product page, return exactly "NO_PRODUCT_INFO". Under 250 words.`,
      }],
    })
    const u = usageFromAnthropic(msg)
    recordUsage({ userId: ctx?.userId, tier: ctx?.tier, feature: 'blog_web_product_research', model: 'claude-haiku-4-5-20251001', input: u.input, output: u.output })

    const out = msg.content.filter(b => b.type === 'text').map(b => (b as { text: string }).text).join('').trim()
    if (!out || out.includes('NO_PRODUCT_INFO')) return ''
    return out
  } catch {
    return ''
  }
}

/**
 * Fallback for when researchProductFromUrl() comes back empty — e.g. the
 * linked page is JS-rendered or blocks scrapers. Uses Claude's web_search
 * to identify the product (from the video title + the linked URL) and
 * pull a factual spec-sheet brief from the open web. Pricier than the
 * direct fetch (Sonnet + a few searches), so only call it when the cheap
 * path returns nothing. Returns '' on failure / no confident product.
 */
export async function researchProductByWebSearch(
  productHint: string,
  sourceUrl: string,
  ctx?: { userId?: string | null; tier?: string | null },
): Promise<string> {
  try {
    const client = createAnthropicClient()
    const msg = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 800,
      tools: [
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        { type: 'web_search_20250305', name: 'web_search', max_uses: 3 } as any,
      ],
      messages: [{
        role: 'user',
        content: `Identify the specific product reviewed in a YouTube video, then pull a FACTUAL spec sheet from the web.

VIDEO TITLE: ${productHint}
LINKED PRODUCT PAGE (often JS-only / blocked, so search for it instead): ${sourceUrl}

Use web search to find the product's real specs. If you cannot confidently identify ONE specific product, reply with exactly "NO_PRODUCT_INFO".

Otherwise return markdown with only web-supported facts:
## Product
One line: what it is + who it's for.
## Key specs & features
Concrete specs/features (dimensions, materials, capacity, modes, compatibility, battery, etc.).
## Price
Approx price if found; else "not listed".
## Notable claims
Standout manufacturer claims worth citing (warranty, certifications, performance numbers).

Rules: ground every fact in search results — do NOT invent. Under 250 words.`,
      }],
    })
    const u = usageFromAnthropic(msg)
    recordUsage({ userId: ctx?.userId, tier: ctx?.tier, feature: 'blog_web_product_search', model: 'claude-sonnet-4-6', input: u.input, output: u.output, webSearches: u.webSearches })

    const out = msg.content.filter(b => b.type === 'text').map(b => (b as { text: string }).text).join('').trim()
    if (!out || out.includes('NO_PRODUCT_INFO')) return ''
    return out
  } catch {
    return ''
  }
}

/**
 * Reject URLs that look like site chrome / UI graphics rather than a
 * real product photo. Critical for Amazon — when their bot-block kicks
 * in, our regexes pick up nav-sprite GIFs / footer logos / privacy
 * icons that downstream gets used as the "product reference image" and
 * the image model invents a generic product. Conservative list — only
 * reject things that are OBVIOUSLY not product photos.
 */
function isJunkImageUrl(url: string): boolean {
  const u = url.toLowerCase()
  return (
    /\/sprites?\//.test(u) ||                           // *.com/sprites/*
    /\/(gno|nav-flyout|nav-sprite|nav-cart|nav-logo)/.test(u) || // Amazon nav UI
    /\/icons?\//.test(u) ||                             // generic /icons/
    /\/logo[s_-]/.test(u) ||                            // /logos/ or logo_x
    /\/favicon/.test(u) ||                              // favicons
    /\/(spinner|loader|loading)\b/.test(u) ||           // spinners
    /\.(?:gif|svg)(?:\?|$)/.test(u) ||                  // GIF/SVG rarely product
    /[?&](?:w|width)=\d{1,2}\b/.test(u) ||              // tiny thumbnails ?w=24
    /\b(\d{1,2})x\1\b/.test(u) ||                       // tiny squares like 16x16
    /transparent-pixel|spacer\.png|1x1\.gif/.test(u)    // tracking pixels
  )
}

/**
 * Pull a real PRODUCT IMAGE off a store/brand product page so the image
 * generator can use the ACTUAL product as a Kontext reference instead of a
 * text-only guess. Used for non-Amazon products (Amazon has its own catalog
 * photo via ASIN). Prefers og:image / twitter:image (the page's chosen hero
 * image), falls back to the first large <img>. Best-effort, timeout-bounded.
 *
 * For multi-candidate vision-picking (in-article image generation), prefer
 * `fetchProductGalleryFromPage` which returns several candidates and lets
 * the caller `pickProductReferenceImage` the cleanest isolated shot.
 */
export async function fetchProductImageFromPage(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' },
      redirect: 'follow',
      signal: AbortSignal.timeout(10000),
    })
    if (!res.ok) return null
    const html = await res.text()
    let img: string | null =
      html.match(/<meta[^>]+property=["']og:image(?::secure_url)?["'][^>]+content=["']([^"']+)["']/i)?.[1] ||
      html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i)?.[1] ||
      html.match(/<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)["']/i)?.[1] ||
      null
    if (!img) {
      // First large <img> — but reject site chrome (sprites, nav graphics)
      // so we never hand the image model an Amazon nav-bar GIF as the
      // "product reference". Scan multiple <img> tags until we find a
      // non-junk one rather than just taking the first.
      for (const m of html.matchAll(/<img[^>]+src=["'](https?:\/\/[^"']+\.(?:jpe?g|png|webp)[^"']*)["']/gi)) {
        if (!isJunkImageUrl(m[1])) { img = m[1]; break }
      }
    }
    if (!img) return null
    if (img.startsWith('//')) img = 'https:' + img
    else if (img.startsWith('/')) { try { img = new URL(img, url).href } catch { /* keep as-is */ } }
    if (!img.startsWith('http')) return null
    // Final guard: even if og:image/twitter:image fired, those can be junk
    // on an Amazon bot-block page (twitter:image set to their default share
    // graphic). Better no reference than the wrong reference downstream.
    if (isJunkImageUrl(img)) return null
    return img
  } catch {
    return null
  }
}

/**
 * Multi-candidate sibling of `fetchProductImageFromPage`. Pulls SEVERAL real
 * product photos off a store/brand product page so the caller can run them
 * through `pickProductReferenceImage` to vision-pick the cleanest isolated
 * shot — same pattern we use for Amazon ASIN pages (gallery → vision-pick).
 *
 * Without this, non-Amazon products only get the page's og:image, which on
 * many DTC brand pages is a lifestyle/hero collage. That ends up driving
 * Kontext to re-render a prop or scene instead of the actual product.
 *
 * Sources, in order:
 *   1. og:image + og:image:secure_url meta tags
 *   2. twitter:image meta tag
 *   3. JSON-LD `Product.image` entries (many Shopify/Woo themes emit these)
 *   4. <link rel="image_src"> hint
 *   5. Up to 6 of the largest-looking <img> tags on the page
 *
 * Returns absolute, http(s) URLs only. Deduped, capped at 8 (matches the
 * Amazon cap so the vision picker has a comparable signal). Empty array on
 * total failure — caller falls back to the single-image variant or text-only.
 */
export async function fetchProductGalleryFromPage(url: string): Promise<string[]> {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' },
      redirect: 'follow',
      signal: AbortSignal.timeout(10000),
    })
    if (!res.ok) return []
    const html = await res.text()
    const candidates: string[] = []

    // 1. og:image / og:image:secure_url (any order in the meta tag)
    for (const re of [
      /<meta[^>]+property=["']og:image(?::secure_url)?["'][^>]+content=["']([^"']+)["']/gi,
      /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image(?::secure_url)?["']/gi,
    ]) {
      for (const m of html.matchAll(re)) candidates.push(m[1])
    }

    // 2. twitter:image (and twitter:image:src variant)
    for (const m of html.matchAll(/<meta[^>]+name=["']twitter:image(?::src)?["'][^>]+content=["']([^"']+)["']/gi)) {
      candidates.push(m[1])
    }

    // 3. JSON-LD Product.image — common on Shopify, WooCommerce, BigCommerce.
    //    image can be a string, an array of strings, or {url: "..."} objects.
    for (const m of html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const json: any = JSON.parse(m[1].trim())
        const nodes = Array.isArray(json) ? json : [json]
        for (const node of nodes) {
          const img = node?.image
          if (!img) continue
          const arr = Array.isArray(img) ? img : [img]
          for (const i of arr) {
            if (typeof i === 'string') candidates.push(i)
            else if (i && typeof i.url === 'string') candidates.push(i.url)
          }
        }
      } catch { /* malformed JSON-LD, skip */ }
    }

    // 4. <link rel="image_src"> — older but still emitted by some CMS themes
    const linkImage = html.match(/<link[^>]+rel=["']image_src["'][^>]+href=["']([^"']+)["']/i)?.[1]
    if (linkImage) candidates.push(linkImage)

    // 5. Fallback: pick up the first few large-looking <img> tags. We crudely
    //    prefer ones with "product" or "main" in their class/id and ones that
    //    have explicit width/height suggesting they're hero shots, not icons.
    const imgRe = /<img[^>]+src=["'](https?:\/\/[^"']+\.(?:jpe?g|png|webp)[^"']*)["'][^>]*>/gi
    let bonus = 0
    for (const m of html.matchAll(imgRe)) {
      candidates.push(m[1])
      bonus++
      if (bonus >= 12) break // hard cap on <img> sweep
    }

    // Normalize: absolute URLs only, https upgrade, dedupe in source order.
    // Reject site-chrome URLs (sprites / nav GIFs / favicons / spacers) —
    // those poison the downstream pipeline when an Amazon bot-block page
    // exposes them as the only scrapable images.
    const seen = new Set<string>()
    const out: string[] = []
    for (let img of candidates) {
      if (!img) continue
      if (img.startsWith('//')) img = 'https:' + img
      else if (img.startsWith('/')) { try { img = new URL(img, url).href } catch { continue } }
      if (!img.startsWith('http')) continue
      if (isJunkImageUrl(img)) continue
      // Strip tracking query suffixes that often differ between duplicates
      // (?v=, ?_=, &width=, &t=, etc.) so we don't carry near-identical URLs.
      const key = img.split('?')[0]
      if (seen.has(key)) continue
      seen.add(key)
      out.push(img)
      if (out.length >= 8) break // mirror Amazon's 8-image cap
    }
    return out
  } catch {
    return []
  }
}
