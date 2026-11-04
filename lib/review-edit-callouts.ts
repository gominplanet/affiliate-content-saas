// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// TEN TITLES FOR THE PRODUCT, TO PUT ON THE VIDEO (Seb, 2026-11-04: "if it's
// an Amazon video, you would expect an ASIN. If it's anything else ... a URL
// for the product. And then MVP would do a little research on the product,
// and come up with ... 10 titles", the creator picking their top 5 before
// the video is queued; lib/review-edit calloutTimes puts them on it).
//
// What the product is comes from its own listing: the Amazon page for an
// ASIN or an Amazon link (title, bullet points, description), the page
// itself for any other link, and a web search when the page cannot be read
// or only a name was typed. The titles are written from those facts alone,
// short enough to read in three seconds, like the creator's examples for a
// projector: "Full HD 1920x1080p", "Projects on any flat surface", "Comes
// with a 180-degree swivel stand". Never a price, a deal, a year, a rating,
// a "best", or a claim the listing does not make. Where the facts came from
// is said with the titles, so a title written from a web search is not
// mistaken for one read off the listing.

import type Anthropic from '@anthropic-ai/sdk'
import { createAnthropicClient } from '@/lib/anthropic'
import { recordUsage, usageFromAnthropic } from '@/lib/ai-usage'
import { fetchAmazonProduct, extractAsin } from '@/services/amazon'
import { researchProductFromUrl, researchProductByWebSearch } from '@/services/research'
import { resolveFinalUrl } from '@/lib/product-link'
import { normalizeAsinInput } from '@/lib/asin'
import { MAX_CALLOUT_CHARS } from '@/lib/review-edit'

export const CALLOUT_IDEAS = 10
const MODEL = 'claude-opus-5-5'

/** What the creator typed in the product box. Pure. */
export type ProductInput = { kind: 'asin'; asin: string } | { kind: 'url'; url: string } | { kind: 'name'; name: string }
export function productInput(raw: string): ProductInput | null {
  const s = String(raw || '').trim()
  if (!s) return null
  const asin = normalizeAsinInput(s)
  if (asin) return { kind: 'asin', asin }
  if (/^https?:\/\/\S+$/i.test(s)) return { kind: 'url', url: s }
  if (/^(www\.)?[a-z0-9-]+(\.[a-z0-9-]+)+\/\S*$/i.test(s)) return { kind: 'url', url: `https://${s}` }
  return s.length >= 3 ? { kind: 'name', name: s.slice(0, 160) } : null
}

/** Words a product title on a video must never carry: prices and deals go
 *  stale, a year dates the video, ratings and "best" are claims the
 *  creator did not make. */
const NOT_ON_SCREEN = /[$€£¥]|\b\d+\s?%\s?off\b|\bpercent off\b|\bprice\b|\bdeal\b|\bdiscount\b|\bon sale\b|\bcoupon\b|\bcheap(est)?\b|\bbest\b|#1\b|\bnumber one\b|\b\d(\.\d)?\s?stars?\b|\bstar rating\b|\b\d[\d,]*\+?\s?(reviews|ratings)\b|amazon'?s choice|best ?seller|\bguarantee/i
/** A year (this one, or near it) dates the video; "2000 lumens" is not a year. */
const A_YEAR = /\b20(1[5-9]|2\d|3[0-5])\b(?!\s*(mah|lumens?|lm|w|watts?|mm|cm|rpm|pa|psi|ml|mg|g|kg|lbs?|oz|hz|mbps|gb|tb|nits|dpi|ppi|x\d))/i

/** The ideas Claude wrote, made safe: short, plain, no repeats, none of the
 *  words above, no emoji, no closing full stop or exclamation mark. Pure. */
export function cleanIdeas(raw: unknown): string[] {
  const list = Array.isArray(raw) ? raw : []
  const out: string[] = []
  for (const v of list) {
    if (typeof v !== 'string') continue
    const t = v
      .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, '')
      .replace(/^[\s\-–—•*"'“”]+|[\s"'“”]+$/g, '')
      .replace(/[.!]+$/, '')
      .replace(/\s+/g, ' ').trim()
    if (t.length < 3 || t.length > MAX_CALLOUT_CHARS || NOT_ON_SCREEN.test(t) || A_YEAR.test(t)) continue
    if (out.some((o) => o.toLowerCase() === t.toLowerCase())) continue
    out.push(t)
    if (out.length >= CALLOUT_IDEAS) break
  }
  return out
}

export type CalloutSource = 'amazon' | 'page' | 'web'
export type CalloutIdeas =
  | { ok: true; product: string; titles: string[]; from: CalloutSource }
  | { ok: false; error: string }

/** What is known about the product, and where it came from. Never throws. */
async function productFacts(input: ProductInput, ctx: { userId: string; tier: string | null }): Promise<{ facts: string; name: string; from: CalloutSource } | { error: string }> {
  if (input.kind === 'asin' || input.kind === 'url') {
    // A short Amazon link (amzn.to, a.co) is opened to find its ASIN.
    let asin = input.kind === 'asin' ? input.asin : null
    let url = input.kind === 'url' ? input.url : `https://www.amazon.com/dp/${input.asin}`
    if (!asin && /^https?:\/\/(amzn\.to|a\.co|amzn\.com)\//i.test(url)) {
      url = await resolveFinalUrl(url).catch(() => url)
      asin = normalizeAsinInput(url) || (/amazon\./i.test(url) ? extractAsin(url) : null)
    }
    if (asin) {
      try {
        const p = await fetchAmazonProduct(asin)
        if (p.title && (p.bullets.length || p.description)) {
          return { name: p.title, from: 'amazon', facts: [`TITLE: ${p.title}`, 'BULLET POINTS:', ...p.bullets.map((b) => `- ${b}`), p.description ? `DESCRIPTION: ${p.description.slice(0, 2500)}` : ''].join('\n') }
        }
      } catch { /* Amazon would not show the page: searched for instead */ }
      const brief = await researchProductByWebSearch(`Amazon product ASIN ${asin}`, `https://www.amazon.com/dp/${asin}`, ctx)
      return brief ? { name: '', from: 'web', facts: brief } : { error: `MVP could not read the Amazon listing for ${asin}. Check the ASIN, or type your own titles.` }
    }
    const page = await researchProductFromUrl(url, '', ctx)
    if (page) return { name: '', from: 'page', facts: page }
    const brief = await researchProductByWebSearch('', url, ctx)
    return brief ? { name: '', from: 'web', facts: brief } : { error: 'MVP could not read that page. Paste the Amazon ASIN, or type your own titles.' }
  }
  const brief = await researchProductByWebSearch(input.name, '', ctx)
  return brief ? { name: input.name, from: 'web', facts: brief } : { error: `MVP could not find "${input.name}". Paste its ASIN or a link to it, or type your own titles.` }
}

/** Ten titles for the product, written from its own listing. Never throws. */
export async function suggestCallouts(raw: string, ctx: { userId: string; tier: string | null }): Promise<CalloutIdeas> {
  const input = productInput(raw)
  if (!input) return { ok: false, error: 'Paste the product’s ASIN, or a link to it.' }
  const facts = await productFacts(input, ctx)
  if ('error' in facts) return { ok: false, error: facts.error }
  try {
    const client = createAnthropicClient()
    const msg = await client.messages.create({
      model: MODEL,
      max_tokens: 4000,
      output_config: {
        effort: 'low',
        format: {
          type: 'json_schema',
          schema: {
            type: 'object',
            properties: {
              product: { type: 'string', description: 'The product in a few words: brand and what it is.' },
              titles: { type: 'array', items: { type: 'string' } },
            },
            required: ['product', 'titles'],
            additionalProperties: false,
          },
        },
      },
      messages: [{
        role: 'user',
        content: `A creator filmed a video review of this product. Write ${CALLOUT_IDEAS + 2} short titles MVP can show on screen over the video, one at a time, each for about three seconds, as the creator talks.

WHAT THE PRODUCT IS (from ${facts.from === 'amazon' ? 'its Amazon listing' : facts.from === 'page' ? 'its own product page' : 'a web search'}):
${facts.facts.slice(0, 7000)}

Each title is one fact about the product a viewer can read at a glance, like these for a projector:
- Full HD 1920x1080p
- Projects on any flat surface
- Comes with a 180-degree swivel stand
- Stereo Sound
- Wifi 6 Compatible
- A complete cinema solution in a compact and versatile projector

Rules:
- Only what the listing above says. Never invent a spec, a number or a feature.
- Mostly 2 to 6 words. One or two may be a longer one-line summary, never over ${MAX_CALLOUT_CHARS} characters.
- Specs, features, what is in the box, what it works with. The most useful facts first.
- Plain words. No price, discount, deal, year, star rating, review count, "best", "#1", award or guarantee. No health or medical claims. No emoji, no exclamation marks, no full stop at the end, no quotation marks.
- No two titles saying the same thing.`,
      }],
    })
    const used = usageFromAnthropic(msg)
    recordUsage({ userId: ctx.userId, tier: ctx.tier, feature: 'review_edit_titles', model: MODEL, input: used.input, output: used.output })
    if (msg.stop_reason === 'refusal') return { ok: false, error: 'MVP could not write titles for this product. Type your own.' }
    const text = msg.content.filter((b): b is Anthropic.TextBlock => b.type === 'text').map((b) => b.text).join('')
    let parsed: { product?: unknown; titles?: unknown } = {}
    try { parsed = JSON.parse(text) } catch { return { ok: false, error: 'MVP’s titles came back unreadable. Try again.' } }
    const titles = cleanIdeas(parsed.titles)
    if (titles.length < 3) return { ok: false, error: 'MVP found too little about this product to write titles. Type your own.' }
    const product = String(parsed.product || facts.name || '').replace(/\s+/g, ' ').trim().slice(0, 120)
    return { ok: true, product, titles, from: facts.from }
  } catch (e) {
    return { ok: false, error: `MVP could not write titles right now: ${e instanceof Error ? e.message : 'no answer'}. Try again.` }
  }
}
