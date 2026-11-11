// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// A YOUTUBE TITLE FOR A PRODUCT REVIEW, in one short call (2026-11-11, Jarett's
// Drop titles). Co-Pilot's metadata writer (/api/youtube/generate-metadata) is
// the first choice: it writes the title with the description and scores it.
// It is also a minute of work, and when it did not answer in time Drop fell
// back to the thumbnail headline writer, whose lines (WORTH IT?, BIG MISTAKE?)
// went to YouTube as titles. This is the fallback instead: real titles that
// name the product, checked by lib/youtube-title-guard, or none at all.
//
// It writes nothing without the product's name: a title about no product is
// the failure this exists to end. Server only.

import { createAnthropicClient } from '@/lib/anthropic'
import { recordAnthropicUsage } from '@/lib/ai-usage'
import { scrubTitle } from '@/lib/scrub'
import { realTitles } from '@/lib/youtube-title-guard'

const MODEL = 'claude-sonnet-4-6'

export async function writeYouTubeTitles(opts: {
  /** Amazon's product title. Required: no name, no titles. */
  productTitle: string
  brand?: string | null
  canonical?: string | null
  /** What the creator already typed or MVP knows of the video, if anything. */
  hint?: string | null
  count?: number
  ctx: { userId: string | null; tier: string | null }
}): Promise<string[]> {
  const productTitle = String(opts.productTitle || '').trim()
  if (!productTitle) return []
  const count = Math.max(3, Math.min(6, opts.count ?? 5))
  const product = { brand: opts.brand || null, canonical: opts.canonical || productTitle }
  const prompt = `Write ${count} YouTube titles for a creator's review video of this product.

THE PRODUCT (Amazon's listing title): "${productTitle}"
${opts.canonical ? `Its short name: "${opts.canonical}"` : ''}
${opts.hint ? `What the creator calls the video so far: "${opts.hint}"` : ''}

Each title:
- Names the product the way a shopper searches for it: the brand and what it is ("Ninja Creami Deluxe", "Beatbot AquaSense 2 Pool Robot"). Never "this product", "this item" or the store it is sold in.
- 45 to 70 characters, in normal title case, not all capitals.
- Says what the viewer finds out: whether it is worth buying, how it does at its job, who it suits, a comparison, a problem it solves.
- Different angles across the ${count}.
- Nothing invented: no results, numbers, time spans or claims the listing does not support.
- No year, no emoji, no dashes used as a pause, and never the word honest in any form.

Return ONLY a JSON array of ${count} strings.`
  try {
    const anthropic = createAnthropicClient()
    const msg = await anthropic.messages.create({ model: MODEL, max_tokens: 600, messages: [{ role: 'user', content: prompt }] }, { timeout: 45_000 })
    try { recordAnthropicUsage(msg, { userId: opts.ctx.userId, tier: opts.ctx.tier, feature: 'yt_title_fallback', model: MODEL }) } catch { /* telemetry */ }
    const text = msg.content.map((b) => (b.type === 'text' ? b.text : '')).join('')
    const m = text.match(/\[[\s\S]*\]/)
    if (!m) return []
    const arr = JSON.parse(m[0]) as unknown[]
    const cleaned = arr.map((t) => scrubTitle(String(t || '')).replace(/\s+[-–—]\s+/g, ': ').trim().slice(0, 100))
    return realTitles(cleaned, product).slice(0, count)
  } catch {
    return []
  }
}
