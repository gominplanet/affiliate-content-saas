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
 * Pull a real PRODUCT IMAGE off a store/brand product page so the image
 * generator can use the ACTUAL product as a Kontext reference instead of a
 * text-only guess. Used for non-Amazon products (Amazon has its own catalog
 * photo via ASIN). Prefers og:image / twitter:image (the page's chosen hero
 * image), falls back to the first large <img>. Best-effort, timeout-bounded.
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
      const m = html.match(/<img[^>]+src=["'](https?:\/\/[^"']+\.(?:jpe?g|png|webp)[^"']*)["']/i)
      img = m?.[1] ?? null
    }
    if (!img) return null
    if (img.startsWith('//')) img = 'https:' + img
    else if (img.startsWith('/')) { try { img = new URL(img, url).href } catch { /* keep as-is */ } }
    return img.startsWith('http') ? img : null
  } catch {
    return null
  }
}
