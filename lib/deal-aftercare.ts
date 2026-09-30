// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// After the deal: turning a deal post whose sale is over into a lasting
// review, in place, at the same address.
//
// A deal post is written for a sale: "Save about 27%", "Limited-time pricing
// worth catching", a purple box that says "Active deal". When the sale ends,
// nothing used to change except a countdown that disabled the only button,
// so the post kept selling a price that was gone and gave the reader nowhere
// to click. The page itself is still worth having: it ranks, it reviews a real
// product, and people still buy that product. What has to go is the sale.
//
// This is the pure half: when a deal counts as ended, what the lasting title
// and intro are, and how the deal shortcodes are marked ended so the plugin
// (1.0.97+) shows "This deal has ended" with a live "Check today's price".

export type DealState = 'ended' | 'on' | 'unknown'

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']

/**
 * The stored end date, as a time. It is an ISO date when Amazon's page carried
 * one, and loose text like "Jul 16" when it did not, with no year. A date with
 * no year is placed in the year the post was published, or the next one when
 * that would put the end before the post. Null when it cannot be read.
 */
export function parseDealEnd(raw: unknown, publishedAt: string | null | undefined): Date | null {
  const s = String(raw ?? '').trim()
  if (!s) return null
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) {
    const d = new Date(s)
    return isNaN(d.getTime()) ? null : d
  }
  const m = /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})(?:,?\s+(\d{4}))?/i.exec(s)
  if (!m) return null
  const month = MONTHS.indexOf(m[1].toLowerCase())
  const day = Number(m[2])
  const pub = publishedAt ? new Date(publishedAt) : null
  let year = m[3] ? Number(m[3]) : (pub && !isNaN(pub.getTime()) ? pub.getUTCFullYear() : new Date().getUTCFullYear())
  // End of that day, so a deal "ending Jul 16" is live all of Jul 16.
  let d = new Date(Date.UTC(year, month, day, 23, 59, 59))
  if (!m[3] && pub && d.getTime() < pub.getTime() - 86_400_000) { year += 1; d = new Date(Date.UTC(year, month, day, 23, 59, 59)) }
  return isNaN(d.getTime()) ? null : d
}

/**
 * Has the deal ended? A passed end date is an answer. Without one, a fresh
 * price check is: 'ended' only when it looked and found no sale. Anything else
 * is 'unknown', never 'ended': rewriting a post while its sale is still on
 * would cost the creator the sale.
 */
export function dealState(input: { endAt: Date | null; now?: number; priceCheck?: DealState | null }): { state: DealState; why: string } {
  const now = input.now ?? Date.now()
  if (input.endAt && input.endAt.getTime() <= now) return { state: 'ended', why: `The deal ended ${input.endAt.toISOString().slice(0, 10)}.` }
  if (input.priceCheck === 'ended') return { state: 'ended', why: 'The latest price check found it is no longer on sale.' }
  if (input.priceCheck === 'on') return { state: 'on', why: 'Still on sale at the latest price check.' }
  if (input.endAt) return { state: 'on', why: `The deal runs until ${input.endAt.toISOString().slice(0, 10)}.` }
  return { state: 'unknown', why: 'No end date was saved and the price has not been checked yet.' }
}

// Sale framing in a title, and the words around it.
const TITLE_SALE: RegExp[] = [
  /^\s*(?:deal alert|[a-z][a-z' ]{0,30}? deal)\s*[:\-–—|]\s*/i,
  /\s*[-–—|:,]?\s*\b(?:save|up to|now)\s+(?:about\s+|over\s+)?(?:\$\d[\d.,]*|\d{1,2}\s?%)\s*(?:off)?\b/gi,
  /\s*[-–—|:,]?\s*\b\d{1,2}\s?%\s*off\b/gi,
  /\s*[-–—|:,]?\s*\b(?:limited[- ]time|lightning|flash)\s+(?:deal|sale|offer|price)s?\b/gi,
  /\s*[-–—|:,]?\s*\bon sale\b/gi,
  /\s*[-–—|:,]?\s*\b(?:deal|sale)\b\s*$/i,
]

/**
 * The title without the sale. "Deal Alert: LEVOIT Tower Fan" becomes "LEVOIT
 * Tower Fan Review"; a title that was already about the product keeps its
 * wording. Pure.
 */
export function lastingTitle(title: string, productName: string): string {
  let t = String(title || '').replace(/\s+/g, ' ').trim()
  for (const re of TITLE_SALE) t = t.replace(re, ' ')
  t = t.replace(/\s{2,}/g, ' ').replace(/^[\s:,\-–—|]+|[\s:,\-–—|]+$/g, '').trim()
  if (t.length < 12) t = String(productName || title).split(/[,(|]/)[0].trim()
  if (!/\b(review|reviewed|tested|worth it|vs\.?|compared|guide|how)\b/i.test(t)) t = `${t} Review`
  return t.length > 90 ? `${t.slice(0, 87).replace(/\s+\S*$/, '')}...` : t
}

/** The intro under the title, true for as long as the page is up. Pure. */
export function lastingExcerpt(productName: string): string {
  const name = String(productName || 'this product').split(/[,(|]/)[0].trim().slice(0, 80) || 'this product'
  return `Our look at the ${name}: what it does well, what to know before you buy, and where to check today's price.`
}

/**
 * Mark the deal shortcodes ended, so the plugin shows the ended box and the
 * ended closing block whatever the stored date says. Returns the content and
 * whether anything changed. Pure.
 */
export function markShortcodesEnded(content: string): { html: string; changed: boolean } {
  let changed = false
  const html = String(content || '').replace(/\[(mvp_deal_banner|mvp_deal_cta)\b([^\]]*)\]/gi, (all, name: string, attrs: string) => {
    if (/\bended\s*=\s*["']?(1|true|yes)\b/i.test(attrs)) return all
    changed = true
    return `[${name}${attrs.replace(/\s+$/, '')} ended="1"]`
  })
  return { html, changed }
}

/** Every shortcode and every link, so a rewrite that lost one is refused. */
export function contentAnchors(html: string): { shortcodes: string[]; hrefs: string[] } {
  const shortcodes = [...String(html).matchAll(/\[(mvp_[a-z_]+)\b/gi)].map((m) => m[1].toLowerCase()).sort()
  const hrefs = [...String(html).matchAll(/href\s*=\s*["']([^"']+)["']/gi)].map((m) => m[1]).sort()
  return { shortcodes, hrefs }
}

/**
 * Is a rewritten article safe to publish? It must keep every shortcode and
 * every link, keep most of its length, and still be HTML. Pure.
 */
export function rewriteIsSafe(before: string, after: string): { ok: boolean; why: string | null } {
  if (!after || after.length < before.length * 0.7) return { ok: false, why: 'the rewrite came back much shorter' }
  if (!/<\/p>/i.test(after)) return { ok: false, why: 'the rewrite was not HTML' }
  const a = contentAnchors(before), b = contentAnchors(after)
  if (a.shortcodes.join('|') !== b.shortcodes.join('|')) return { ok: false, why: 'the rewrite lost or added a deal box' }
  const missing = a.hrefs.filter((h) => !b.hrefs.includes(h))
  if (missing.length) return { ok: false, why: `the rewrite dropped ${missing.length} link${missing.length === 1 ? '' : 's'}` }
  return { ok: true, why: null }
}

// ── Back on sale ───────────────────────────────────────────────────────────
//
// A lasting review whose product goes on sale again gets its deal back, in the
// box and the intro only. The article stays the lasting review and the title
// stays put, so the page does not swing its wording (and its ranking) back and
// forth with every sale. When that sale ends, the box and intro go back.

/** Where a deal post is in its life. Pure. */
export type DealPhase = 'deal' | 'lasting' | 'revived'
export function dealPhase(meta: { endedAt?: unknown; revivedAt?: unknown } | null | undefined): DealPhase {
  const ended = Date.parse(String(meta?.endedAt || '')) || 0
  const revived = Date.parse(String(meta?.revivedAt || '')) || 0
  if (!ended && !revived) return 'deal'
  return revived > ended ? 'revived' : 'lasting'
}

/**
 * Bring the deal boxes back: no ended flag, the new discount on the chip, and
 * the new end date (a lightning deal's) or none, never the old one, which is
 * in the past and would show the box ended again. Pure.
 */
export function reviveShortcodes(content: string, sale: { pct: number | null; endsAt: string | null }): { html: string; changed: boolean } {
  // NO PERCENTAGE ON THE CHIP. Amazon allows a discount on a page only while
  // it lasts, and this is checked hours apart, not the moment it ends.
  void sale.pct
  const badge = 'ON SALE'
  let changed = false
  const html = String(content || '').replace(/\[(mvp_deal_banner|mvp_deal_cta)\b([^\]]*)\]/gi, (_all, name: string, attrs: string) => {
    let a = attrs
      .replace(/\s+ended\s*=\s*["']?[^"'\s\]]*["']?/gi, '')
      .replace(/\s+end_date\s*=\s*"[^"]*"|\s+end_date\s*=\s*'[^']*'/gi, '')
      .replace(/\s+badge\s*=\s*"[^"]*"|\s+badge\s*=\s*'[^']*'/gi, '')
      .replace(/\s+$/, '')
    a += ` badge="${badge}"`
    if (name.toLowerCase() === 'mvp_deal_banner' && sale.endsAt) a += ` end_date="${sale.endsAt}"`
    const out = `[${name}${a}]`
    if (out !== `[${name}${attrs}]`) changed = true
    return out
  })
  return { html, changed }
}

/** The first product link in the article, for a post that never had a deal box. */
export function firstProductHref(content: string): string | null {
  const m = /href\s*=\s*["'](https?:\/\/[^"']*(?:amazon\.[a-z.]+|amzn\.to|geni\.us|mvpl\.ink)[^"']*)["']/i.exec(String(content || ''))
  return m ? m[1] : null
}

/** The intro while the product is on sale again. Pure. */
export function saleAgainExcerpt(pct: number | null, productName: string): string {
  void pct
  const lead = 'On sale again right now.'
  return `${lead} ${lastingExcerpt(productName)}`
}
