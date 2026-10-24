// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// A TIKTOK CAPTION NEVER SENDS ANYONE OFF TIKTOK (Jarett, 2026-10-24: TikTok
// Shop flagged a Clip Factory post, "Your video redirects users away from
// TikTok Shop to unverified sites or third-party platforms", for "Link in bio
// to shop it", the Amazon Associates line twice and a disclosure about the
// links on a site). TikTok captions are not clickable, so nothing is lost:
// every sentence that points somewhere else to buy comes out (a link, "link
// in bio", Amazon or another store, an affiliate-link disclosure), hashtags
// that name another store go too, and the post is disclosed with #ad, the one
// disclosure that names no other place. Applied where Clip Factory builds the
// TikTok text (so the preview is what posts) and again in services/tiktok, so
// no path to TikTok can miss it. Pure.

import { ensureAdTags } from '@/lib/social-disclaimer'

/** Other places to buy. TikTok Shop treats naming them as sending people away. */
const STORES = 'amazon|amzn|walmart|temu|shein|aliexpress|ebay|etsy|best\\s*buy|shopltk|\\bltk\\b|linktree|linktr\\.ee|stan\\.store|geni\\.us|bit\\.ly'
const OFF_TIKTOK: RegExp[] = [
  /\blinks?\s+(?:is\s+|are\s+)?in\s+(?:my\s+|the\s+)?bio\b/i,
  /\bin\s+my\s+bio\b/i,
  /\bbio\s+link\b/i,
  /\bassociates?\b[^.!?\n]{0,40}\bqualifying\b|\bqualifying\s+purchases\b/i,
  /\baffiliate\s+links?\b/i,
  /\b(?:earn|make|receive)\s+(?:a\s+)?(?:small\s+)?commissions?\b/i,
  /\blinks?\s+(?:on|in)\s+this\s+(?:site|page|post|description)\b/i,
  /\b(?:on|at|from|via|to)\s+my\s+(?:blog|website|site|storefront|store|shop\s+page)\b/i,
  /\bstorefront\b/i,
  /https?:\/\/\S+|\bwww\.\S+/i,
  /\b[a-z0-9-]{2,}\.(?:com|co|net|io|to|ly|me|shop|store|link|ink)\b/i,
  new RegExp(`(?:${STORES})`, 'i'),
]
const STORE_TAG = new RegExp(`^#[\\p{L}\\p{N}_]*(?:${STORES.replace(/\\\\b/g, '').replace(/\\\\s\*/g, '').replace(/\\\\\./g, '')})`, 'iu')

/** The sentences and tags that stay on TikTok, with #ad. Pure. */
export function tiktokSafeCaption(text: string): string {
  const keptTags: string[] = []
  const lines: string[] = []
  for (const raw of String(text || '').split('\n')) {
    const line = raw.trim()
    if (!line) { lines.push(''); continue }
    // Sentences end at . ! or ? before a space, so "straye.com" stays one.
    const parts = line.split(/(?<=[.!?])\s+/)
    const keep: string[] = []
    for (const p of parts) {
      const tags = p.match(/#[\p{L}\p{N}_]+/gu) || []
      const words = p.replace(/#[\p{L}\p{N}_]+/gu, '').trim()
      if (words && OFF_TIKTOK.some((re) => re.test(words))) {
        // The sentence goes; its hashtags are kept unless they name a store.
        for (const t of tags) if (!STORE_TAG.test(t)) keptTags.push(t)
        continue
      }
      keep.push(tags.length ? p.replace(/#[\p{L}\p{N}_]+/gu, (t) => (STORE_TAG.test(t) ? '' : t)) : p)
    }
    const out = keep.join(' ').replace(/^[\s🛒👉🔗📌👆:\-|]+$/u, '').replace(/[ \t]{2,}/g, ' ').trim()
    if (out) lines.push(out)
  }
  let body = lines.join('\n').replace(/\n{3,}/g, '\n\n').trim()
  // Each line once: the same sentence twice reads as a copy and paste.
  const seen = new Set<string>()
  body = body.split('\n').filter((l) => { const k = l.trim().toLowerCase(); if (!k) return true; if (seen.has(k)) return false; seen.add(k); return true }).join('\n').replace(/\n{3,}/g, '\n\n').trim()
  const have = new Set((body.match(/#[\p{L}\p{N}_]+/gu) || []).map((t) => t.toLowerCase()))
  const extra = Array.from(new Set(keptTags.map((t) => t.toLowerCase()))).filter((t) => !have.has(t))
  const extraOriginal = extra.map((t) => keptTags.find((k) => k.toLowerCase() === t) as string)
  if (extraOriginal.length) body = `${body}\n\n${extraOriginal.join(' ')}`.trim()
  return ensureAdTags(body, { onlyAd: true, firstLine: true })
}

/** Whether a caption would send people off TikTok, for a warning. Pure. */
export function sendsOffTikTok(text: string): boolean {
  return String(text || '').split('\n').some((l) => l.split(/(?<=[.!?])\s+/).some((p) => { const w = p.replace(/#[\p{L}\p{N}_]+/gu, '').trim(); return !!w && OFF_TIKTOK.some((re) => re.test(w)) }))
}
