// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// Resolve the Amazon ASIN(s) a blog post monetizes — from data we ALREADY store,
// no new schema. Powers per-post revenue attribution (revenue loop #249): the
// uploaded Associates earnings are keyed by ASIN, so to put "$ earned" on a post
// we need to know which ASIN(s) that post links.
//
// Sources, most-reliable first:
//   1. deal_meta.asin             — Deals Hub posts store the ASIN structured.
//   2. youtube_videos.product_url — the product URL resolved at generation time
//      (a plain Amazon /dp/{ASIN}; a Geniuslink-wrapped URL carries no ASIN).
//   3. post body content          — any direct Amazon /dp/{ASIN} links present.
//
// Coverage is best-effort: a post whose only link is a geni.us wrap won't
// resolve (we never persisted the source ASIN), so it simply shows no $ — a
// strict improvement over today, never a regression. 100% coverage is a clean
// follow-up: persist the resolved ASIN on blog_posts at generation time.

/**
 * Amazon ASIN = 10-char uppercase alphanumeric. Anchored to a product path or
 * an asin= param so we never false-match an arbitrary 10-char path segment, and
 * a trailing negative-lookahead so we don't clip the first 10 of a longer token.
 */
const ASIN_IN_URL =
  /(?:\/dp\/|\/gp\/product\/|\/gp\/aw\/d\/|\/product\/|[?&]asin=)([A-Z0-9]{10})(?![A-Z0-9])/gi

/** Every Amazon ASIN linked in a blob of text/HTML (deduped, uppercased). */
export function extractAsinsFromText(text: string | null | undefined): string[] {
  if (!text) return []
  const found = new Set<string>()
  ASIN_IN_URL.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = ASIN_IN_URL.exec(text)) !== null) found.add(m[1].toUpperCase())
  return [...found]
}

/** Pull the ASIN out of a deal_meta JSONB envelope (Deals Hub posts). */
export function asinFromDealMeta(dealMeta: unknown): string | null {
  if (!dealMeta || typeof dealMeta !== 'object') return null
  const a = (dealMeta as Record<string, unknown>).asin
  return typeof a === 'string' && /^[A-Z0-9]{10}$/i.test(a.trim())
    ? a.trim().toUpperCase()
    : null
}

export interface PostAsinSources {
  dealMeta?: unknown
  /** The video's resolved product_url (youtube_videos.product_url). */
  productUrl?: string | null
  /** The post body HTML (for any direct /dp/ links). */
  content?: string | null
}

/** Resolve every ASIN a post is associated with (deduped, uppercase). */
export function resolvePostAsins(src: PostAsinSources): string[] {
  const out = new Set<string>()
  const deal = asinFromDealMeta(src.dealMeta)
  if (deal) out.add(deal)
  for (const a of extractAsinsFromText(src.productUrl)) out.add(a)
  for (const a of extractAsinsFromText(src.content)) out.add(a)
  return [...out]
}
