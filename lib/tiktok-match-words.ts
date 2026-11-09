// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// Match my TikTok's words and types the page shows (components/labs/
// TrybeTikTokMatch). Apart from lib/tiktok-match so the page never loads the
// matcher's English word list. Pure.

export type MatchKind = 'product_tag' | 'mention' | 'hashtag' | 'name' | 'product'
export type Sureness = 'sure' | 'likely' | 'maybe'

/** The matches the page shows as matches: sure and likely. Maybes are shown
 *  apart and never counted as a brand you filmed. */
export const isMatch = (m: { sureness: Sureness | string }) => m.sureness !== 'maybe'

export const SURENESS_WORDS: Record<Sureness, { label: string; says: string }> = {
  sure: { label: 'Sure', says: 'The video’s product tag or your caption’s @tag points at this brand.' },
  likely: { label: 'Likely', says: 'Your caption names the brand, written as its name, or one of its products.' },
  maybe: { label: 'Maybe', says: 'The brand is named after an everyday word, so your caption may just use the word. Check the video.' },
}

// ── THE REQUEST TO A BRAND YOU FILMED (Seb, 2026-11-09: "request partnership
// with the brand ... all from there") ─────────────────────────────────────
// A request to a brand Match my TikTok matched says, in one line of MVP's own,
// that the creator already made a video with it, with the video's TikTok
// address. Written by MVP, not the request writer, so it is there every time,
// exact, and the writer's "keep the core message word for word" holds.

/** The line: "I already made a TikTok video featuring your Ninja CREAMi
 *  Deluxe: <url>", in the core message's voice (we or I). Null without a
 *  TikTok video address. Never a price: a product title's $ amount is dropped. */
export function filmedLine(o: { core: string; url: string | null | undefined; product?: string | null; brand: string }): string | null {
  const url = String(o.url || '').trim()
  if (!/^https:\/\/(www\.)?tiktok\.com\/@[^/\s]+\/video\/\d+/i.test(url)) return null
  const we = /\b(we|we're|we've|our|us)\b/i.test(o.core) && !/\b(I|I'm|I've|my)\b/.test(o.core)
  const product = String(o.product || '').replace(/\$\s?\d[\d,.]*/g, '').replace(/\s+/g, ' ').trim()
  const what = product && product.length <= 70 ? `your ${product}` : o.brand.trim() || 'your brand'
  return `${we ? 'We' : 'I'} already made a TikTok video featuring ${what}: ${url}`
}

/** The draft with the line after its greeting (its first paragraph). Left as
 *  it was when the address is already in it. */
export function withFilmedLine(draft: string, line: string | null): string {
  if (!line) return draft
  const url = line.slice(line.lastIndexOf(' ') + 1)
  if (draft.includes(url)) return draft
  const parts = draft.split(/\n\s*\n/)
  if (parts.length < 2) return `${draft.trim()}\n\n${line}`
  return [parts[0], line, ...parts.slice(1)].join('\n\n')
}
