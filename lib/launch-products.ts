/**
 * UP TO THREE PRODUCTS ON ONE AMAZON VIDEO (Bulk Amazon upload).
 *
 * Douglas Brinkley asked (2026-11-04): "When I post Amazon videos I typically
 * tag up to three variations. However, the bulk upload only allows you to list
 * one ASIN." Seb: build the three, and never point anyone at the parent ASIN,
 * which is unreliable. Each one is the exact product: the colour or size shown.
 *
 * The FIRST product is the video's product, the one everything else is made
 * from: the YouTube title, the description and its affiliate link, the
 * thumbnails, the countries check. The other two are only tagged on the Amazon
 * video. They are kept in `launch_items.more_asins` (migration 464) and read by
 * the upload queue when the Amazon upload happens, so a change made before the
 * upload is always the one that goes.
 *
 * Pure, so the Product box, the save route, the upload queue and the tests all
 * read one copy.
 */

export const MAX_PRODUCTS_PER_VIDEO = 3

const ASIN = /^[A-Z0-9]{10}$/

/**
 * What was pasted, as separate products. Spaces, new lines, commas and
 * semicolons separate them. A link keeps a comma inside itself (Amazon's
 * search links can carry one), and is only split where a second link starts.
 */
export function splitProductInput(raw: string): string[] {
  const out: string[] = []
  for (const piece of String(raw || '').split(/\s+/)) {
    if (!piece) continue
    const parts = /^https?:\/\//i.test(piece)
      ? piece.split(/[,;|]+(?=[hH][tT][tT][pP][sS]?:\/\/|[A-Z0-9]{10}(?:[,;|]|$))/)
      : piece.split(/[,;|]+/)
    for (const p of parts) {
      const t = p.replace(/^[,;|]+|[,;|]+$/g, '').trim()
      if (t) out.push(t)
    }
  }
  return out
}

/** The ASINs in order, upper case, each once. */
export function uniqueAsins(list: Array<string | null | undefined>): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const a of list) {
    const s = String(a || '').trim().toUpperCase()
    if (!ASIN.test(s) || seen.has(s)) continue
    seen.add(s)
    out.push(s)
  }
  return out
}

/** The extra products as stored: clean ASINs only, never the main one, at most two. */
export function cleanMoreAsins(main: string | null | undefined, more: unknown): string[] {
  const list = Array.isArray(more) ? more.map((x) => String(x ?? '')) : []
  const m = String(main || '').trim().toUpperCase()
  return uniqueAsins(list).filter((a) => a !== m).slice(0, MAX_PRODUCTS_PER_VIDEO - 1)
}

/** What the Product box shows for a saved video: the main ASIN, then the others. */
export function productBoxText(asin: string | null | undefined, more: unknown): string {
  return uniqueAsins([asin, ...cleanMoreAsins(asin, more)]).join(' ')
}

/**
 * The extra products for one Amazon listing.
 *
 * Only on the US store: the other two were pasted as US products, and another
 * country can sell the same thing under its own ASIN, which is what the main
 * product's local ASIN check is for. Only when the listing carries the video's
 * own product, so a listing that was given a local ASIN never has products
 * from somewhere else added to it.
 */
export function moreAsinsForListing(
  domain: string | null | undefined,
  listingAsin: string | null | undefined,
  mainAsin: string | null | undefined,
  more: unknown,
): string[] {
  if (!/^(www\.)?amazon\.com$/i.test(String(domain || '').trim())) return []
  const listing = String(listingAsin || '').trim().toUpperCase()
  if (!listing || listing !== String(mainAsin || '').trim().toUpperCase()) return []
  return cleanMoreAsins(listing, more)
}

/**
 * The line saved on the listing after an upload, saying which products are
 * really on the Amazon video. SCOUT before 1.55.0 tags the first one only and
 * says nothing about the rest, so a listing that asked for more and got no
 * answer about them says so, rather than reading like all three went on.
 */
export function taggedLine(
  wanted: { asin?: string | null; moreAsins?: string[] | null },
  answer: { tagged?: unknown; notTagged?: unknown },
): string | null {
  const more = uniqueAsins(wanted.moreAsins ?? [])
  const tagged = Array.isArray(answer.tagged) ? uniqueAsins(answer.tagged as string[]) : null
  const missed = Array.isArray(answer.notTagged)
    ? (answer.notTagged as Array<{ asin?: string; reason?: string }>).filter((x) => x && x.asin)
    : []
  if (tagged === null) {
    if (more.length === 0) return null
    return `tagged ${String(wanted.asin || '').toUpperCase()} only. Update SCOUT to tag ${more.join(' and ')} too`
  }
  if (tagged.length === 0) return null
  let line = `tagged ${tagged.join(', ')}`
  if (missed.length) {
    line += `. Not tagged: ${missed.map((x) => `${String(x.asin).toUpperCase()} (${String(x.reason || 'Amazon said no').slice(0, 50)})`).join(', ')}`
  }
  return line
}

/** The upload's saved line with the products really tagged on it added, when
 *  the video asked for more than one or SCOUT said which went on. */
export function withTagged(
  base: string,
  item: { asin?: string | null; moreAsins?: unknown } | null | undefined,
  answer: { tagged?: unknown; notTagged?: unknown },
): string {
  const line = taggedLine({ asin: item?.asin ?? null, moreAsins: Array.isArray(item?.moreAsins) ? item.moreAsins as string[] : [] }, answer)
  return line ? `${base}, ${line}` : base
}
