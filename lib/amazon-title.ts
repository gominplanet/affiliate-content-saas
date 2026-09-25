// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// The title an Amazon storefront video carries: short, a hook, in the
// creator's own storefront voice.
//
// WHY IT IS NOT THE YOUTUBE TITLE. YouTube rewards a longer, search-shaped
// title ("Is the Redane 4.6GPM Cordless Fuel Transfer Pump Really Good Enough
// to Ditch Manual Pumping?"). An Amazon storefront video sits beside the
// product itself, so it does not need the product's name spelled out; it
// needs a reason to press play. Liftoff used the thumbnail headline writer
// for this line instead (FLY TRAP WORKS, GNATS GONE?), which is neither.
//
// TAUGHT ON THE CREATOR'S OWN STOREFRONT. The examples below are the titles
// on amazon.com/shop/gominplanet, the style the creator asked for by name:
// four to nine words, a question or an exclamation, often one word in
// capitals for the punch, personal and visual, rarely the brand.
//
// ENGLISH. Every other store's title is translated from this one.

import { fetchAmazonProduct } from '@/services/amazon'
import { createAnthropicClient } from './anthropic'
import { recordAnthropicUsage } from './ai-usage'
import { scrubBanned } from './scrub'

/** The creator's own storefront titles, verbatim. */
export const STOREFRONT_TITLE_EXAMPLES = [
  'Watch it Glow at Night - Mesmerizing!',
  'The Perfect Mat for Small Bathrooms?',
  'See My Tasty Chia Seed Smoothie Bowl',
  'A Complete DashCam System for Your Car in 4K?',
  'I Did Not Want to Believe It - Then It Happened!',
  'No More Old School SIPHONING!',
  'Soft and Light Enough Only For Summer?',
  'Must See TEXTURE Up Close!',
  'Are These Color-Coded Clipper Guards STURDY?',
  'Is It As Cozy At It Seems?',
]

const MODEL = 'claude-haiku-4-5-20251001'

/** Clean one line into a storefront title, or null when it cannot be one. */
export function cleanAmazonTitle(raw: string, asin?: string | null): string | null {
  let t = scrubBanned(String(raw || '').trim().replace(/^["'\s]+|["'\s]+$/g, ''))
  // No dashes of any kind as a sentence break: the creator's rule for anything
  // MVP writes. "Glow at Night - Mesmerizing!" becomes "Glow at Night, Mesmerizing!"
  t = t.replace(/\s+[-–—]+\s+/g, ', ').replace(/[–—]/g, ', ')
  t = t.replace(/\s{2,}/g, ' ').trim()
  if (!t) return null
  if (asin && t.toUpperCase().includes(asin.toUpperCase())) return null
  // No year in a title: it dates the video the day it goes up.
  if (/\b(19|20)\d{2}\b/.test(t)) return null
  if (/amazon/i.test(t)) return null
  const words = t.split(/\s+/).filter(Boolean)
  if (words.length < 3 || words.length > 11) return null
  if (t.length > 70) return null
  return t
}

export async function generateAmazonTitleOptions(opts: {
  asin?: string | null
  /** The product's real name, looked up from the ASIN when left out. */
  productTitle?: string | null
  /** The YouTube title, a hint about the video's angle. */
  videoTitle?: string | null
  count?: number
  ctx: { userId: string | null; tier: string | null }
}): Promise<string[]> {
  const count = Math.max(3, Math.min(8, opts.count ?? 5))
  const asin = (opts.asin || '').trim()
  let productTitle = (opts.productTitle || '').trim()
  if (!productTitle && asin) {
    try { productTitle = String((await fetchAmazonProduct(asin))?.title || '').trim() } catch { /* the ASIN alone */ }
  }
  const videoTitle = (opts.videoTitle || '').trim()

  const prompt = `Write ${count} DISTINCT titles for a short product video on an Amazon storefront. The shopper sees the product listed right beside the video, so the title's job is to make them press play.

THE PRODUCT: "${productTitle || 'unknown'}"
${videoTitle && (!asin || videoTitle.toUpperCase() !== asin.toUpperCase()) ? `THE VIDEO'S YOUTUBE TITLE (its angle): "${videoTitle}"` : ''}

WRITE IN THIS CREATOR'S STYLE. These are the titles on their own storefront (their dashes shown as commas, since this creator's titles are written without dashes):
${STOREFRONT_TITLE_EXAMPLES.map((t) => `- ${t.replace(/\s+-\s+/g, ', ')}`).join('\n')}

WHAT THAT STYLE IS:
- 4 to 9 words. Title Case.
- A hook: a question the video answers ("Is It As Cozy As It Seems?") or an exclamation ("No More Old School SIPHONING!").
- Often ONE word in capitals for the punch (SIPHONING, TEXTURE, STURDY). Never more than one.
- Personal and visual: "I", "My", "See", "Watch", "Up Close", "Real".
- About what the product DOES or FEELS LIKE for a person, not a list of specs. Name the product type in plain words when it helps ("Clipper Guards", "Bathroom Mat"), but not the full Amazon product name, and rarely the brand.
- Different angles across the ${count}: a question, a benefit, a surprise, a first-person reaction, a visual.

NEVER:
- A dash of any kind (no " - ", no en or em dash). Use a comma or a second sentence instead.
- The ASIN, the word Amazon, a year, emojis, or hashtags.
- Invented results or numbers the product name does not give ("after 30 days", "lost 10 lbs").
- Hype words: AMAZING, INSANE, INCREDIBLE, GAME-CHANGER, or any form of "honest".
- ALL CAPS for the whole title.

Return ONLY a JSON array of exactly ${count} strings. No prose around it.`

  try {
    const anthropic = createAnthropicClient()
    const msg = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 400,
      messages: [{ role: 'user', content: prompt }],
    })
    recordAnthropicUsage(msg, { userId: opts.ctx.userId, tier: opts.ctx.tier, feature: 'amazon_video_title', model: MODEL })
    const text = ((msg.content[0] as { type: string; text: string }).text || '').trim()
    const m = text.match(/\[[\s\S]*\]/)
    if (!m) return []
    const arr = JSON.parse(m[0]) as unknown[]
    const seen = new Set<string>()
    const out: string[] = []
    for (const raw of arr) {
      const t = cleanAmazonTitle(String(raw ?? ''), asin)
      if (!t) continue
      const key = t.toLowerCase()
      if (seen.has(key)) continue
      seen.add(key)
      out.push(t)
    }
    return out.slice(0, count)
  } catch {
    return []
  }
}
