/**
 * Detect whether a YouTube video is about a specific buyable product
 * even when the title doesn't carry an ASIN, then look the product up
 * on Amazon to recover an ASIN we can wrap with an affiliate link.
 *
 * Used by the YouTube Co-Pilot + Library blog generation before they
 * decide to fall back to general-video mode — so a "Bose QuietComfort
 * review" video without an ASIN in the title still gets the product
 * treatment + an affiliate link.
 *
 * Two-step pipeline:
 *  1. Haiku call extracts a 4–8-word Amazon search query if the video
 *     is about a buyable product, or returns null for vlogs / stories.
 *  2. searchAmazonForAsin() scrapes Amazon search and returns the
 *     top ASIN, or null if Amazon blocked us / no good match.
 *
 * Either step can fail safely — null result means "treat as general"
 * and the caller proceeds without an affiliate link.
 */
import { createAnthropicClient } from '@/lib/anthropic'
import { recordAnthropicUsage } from '@/lib/ai-usage'
import { searchAmazonForAsin, extractAsin } from '@/services/amazon'

export interface DiscoveredProduct {
  /** ASIN we resolved (either from the title directly or via Amazon
   *  search). null = could not resolve a product. */
  asin: string | null
  /** The search query the agent built — useful for logging / debugging.
   *  null when the detector decided this isn't a product video. */
  productQuery: string | null
  /** Where the ASIN came from, for telemetry / UI surfacing. */
  source: 'title' | 'search' | 'none'
}

export async function discoverProductForVideo(
  videoTitle: string,
  videoDescription: string,
  ctx?: { userId?: string | null; tier?: string | null },
): Promise<DiscoveredProduct> {
  // Fast path — title already carries an ASIN, just use it.
  const existing = extractAsin((videoTitle || '').toUpperCase())
  if (existing) return { asin: existing, productQuery: null, source: 'title' }

  // Step 1: ask Haiku whether the video is about a buyable product. If
  // yes, get the best Amazon search query (brand + model, 4-8 words).
  const anthropic = createAnthropicClient()
  let productQuery: string | null = null
  try {
    const msg = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 200,
      system: 'You extract product information from YouTube video titles. Return ONLY valid JSON.',
      messages: [{
        role: 'user',
        content: `Look at this YouTube video title + first lines of its description.
If it's about a SPECIFIC PHYSICAL PRODUCT a viewer can buy on Amazon (electronics, tools, gadgets, beauty, gear, kitchen, books, toys, etc.), return the best Amazon search query for it.

Rules for the query:
- 4-8 words max
- Lead with brand + model number / name if available
- Skip filler words: "review", "unboxing", "best", "honest", "vs", "I tried", "watch this"
- Skip platform names: "YouTube", "TikTok"
- If multiple products are compared, return the FIRST / MAIN one
- If the video is general content (vlog, opinion, tutorial without a single product, news, story, day-in-the-life, podcast), return null

TITLE: ${videoTitle}
DESCRIPTION (first 500 chars): ${(videoDescription || '').slice(0, 500)}

Return JSON, nothing else:
{ "productQuery": "Brand Model query string" }
or
{ "productQuery": null }`,
      }],
    })
    recordAnthropicUsage(msg, {
      userId: ctx?.userId ?? null, tier: ctx?.tier ?? null,
      feature: 'product_detect', model: 'claude-haiku-4-5-20251001',
    })
    const raw = (msg.content[0] as { type: string; text: string }).text
    const match = raw.match(/\{[\s\S]*\}/)
    if (match) {
      try {
        const parsed = JSON.parse(match[0]) as { productQuery?: string | null }
        if (typeof parsed.productQuery === 'string' && parsed.productQuery.trim()) {
          productQuery = parsed.productQuery.trim()
        }
      } catch { /* fall through to null */ }
    }
  } catch { /* Haiku failure → general mode */ }

  if (!productQuery) return { asin: null, productQuery: null, source: 'none' }

  // Step 2: search Amazon for the query and grab the top ASIN.
  const asin = await searchAmazonForAsin(productQuery)
  if (!asin) return { asin: null, productQuery, source: 'none' }
  return { asin, productQuery, source: 'search' }
}
