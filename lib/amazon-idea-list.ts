// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// Read an Amazon Influencer "idea list" (/shop/<handle>/list/<id>) server-side.
// Amazon lazy-loads long lists, so a single fetch reliably returns the FIRST
// page (~20 items) — enough to pick a top 10. The SCOUT extension captures the
// FULL list in-browser and posts the same shape to /api/idea-list/ingest; this
// module is the paste-a-URL path (and the parser both share).

export interface IdeaListItem {
  asin: string
  title: string | null
  image: string | null
}
export interface IdeaListParse {
  title: string | null
  declaredCount: number | null
  items: IdeaListItem[]
  partial: boolean          // true when declaredCount > items.length (lazy-load tail not fetched)
}

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36'

/** Pull the list's ASINs (+ best-effort title/image) out of the list HTML. */
export function parseIdeaListHtml(html: string): IdeaListParse {
  // List name: the page <title> is "<handle name>'s Amazon Page" — not the list
  // title. The list title sits in the h1/heading; grab the first non-empty one
  // that isn't the profile name, else fall back to the item-count section label.
  let title: string | null = null
  const h1 = html.match(/<h1[^>]*>([^<]{3,120})<\/h1>/i)
  if (h1) title = cleanListName(decodeEntities(h1[1]))
  if (!title) {
    const og = html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']{3,180})["']/i)
    if (og) title = cleanListName(decodeEntities(og[1]))
  }

  const declaredMatch = html.match(/itemcount["'][^>]*>\s*([\d,]+)\s*Items?/i)
  const declaredCount = declaredMatch ? parseInt(declaredMatch[1].replace(/,/g, ''), 10) : null

  // Walk each product tile (an element carrying data-asin="XXXXXXXXXX"). The
  // product name is the tile's VISIBLE TEXT up to the first price ($nn.nn) —
  // Amazon leaves the <img alt> empty on these list tiles. The image is the
  // first <img src> in the tile.
  const items: IdeaListItem[] = []
  const seen = new Set<string>()
  const re = /data-asin=["']([A-Z0-9]{10})["']/g
  let m: RegExpExecArray | null
  while ((m = re.exec(html))) {
    const asin = m[1]
    if (seen.has(asin)) continue
    seen.add(asin)
    const window = html.slice(m.index, m.index + 2200)
    const imgM = window.match(/<img[^>]+src=["']([^"']+\.(?:jpg|jpeg|png|webp)[^"']*)["']/i)
    const image = imgM ? imgM[1] : null
    items.push({ asin, title: extractTileTitle(window), image })
  }

  return {
    title,
    declaredCount,
    items,
    partial: declaredCount != null && items.length < declaredCount,
  }
}

/** Fetch + parse a list URL. Throws on a non-200 / robot page. */
export async function fetchIdeaList(rawUrl: string): Promise<IdeaListParse> {
  const url = normalizeListUrl(rawUrl)
  if (!url) throw new Error('That doesn’t look like an Amazon idea-list link (amazon.com/shop/…/list/…).')
  const res = await fetch(url, {
    headers: { 'User-Agent': UA, 'Accept-Language': 'en-US,en;q=0.9', Accept: 'text/html' },
    signal: AbortSignal.timeout(25_000),
  })
  if (!res.ok) throw new Error(`Amazon returned ${res.status} for that list.`)
  const html = await res.text()
  const parsed = parseIdeaListHtml(html)
  if (parsed.items.length === 0) {
    if (/api-services-support|To discuss automated access|Robot Check/i.test(html)) {
      throw new Error('Amazon blocked the read (bot check). Use the SCOUT extension to capture this list instead.')
    }
    throw new Error('Could not find any products on that list.')
  }
  return parsed
}

/** Keep only real Amazon influencer list URLs; strip tracking params we don't need. */
export function normalizeListUrl(raw: string): string | null {
  try {
    const u = new URL(raw.trim())
    if (!/(^|\.)amazon\.[a-z.]+$/i.test(u.hostname)) return null
    if (!/\/shop\/[^/]+\/list\/[A-Z0-9]+/i.test(u.pathname)) return null
    // Drop everything but the path + a tag if present (keeps the URL stable/cacheable).
    const tag = u.searchParams.get('tag')
    return `https://www.amazon.com${u.pathname}${tag ? `?tag=${encodeURIComponent(tag)}` : ''}`
  } catch { return null }
}

/** Product name = tile text up to the first price, badges + repeated brand stripped. */
function extractTileTitle(tileHtml: string): string | null {
  // Skip the opening tag so its attributes (data-asin=…) don't leak into text.
  const afterTag = tileHtml.slice(tileHtml.indexOf('>') + 1)
  let txt = decodeEntities(afterTag.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim()
  const priceAt = txt.search(/\$\s?\d/)
  if (priceAt > 0) txt = txt.slice(0, priceAt)
  txt = txt.replace(/^(Best ?Seller|Amazon['’]?s Choice|Overall Pick|Editor['’]?s Pick|Limited time deal|Sponsored|More Buying Choices|Popular pick|New)\s*/i, '').trim()
  // Collapse an immediately-repeated leading brand token ("LEAGOO LEAGOO …").
  const w = txt.split(' ')
  if (w.length > 2 && w[0].toLowerCase() === w[1].toLowerCase()) txt = w.slice(1).join(' ')
  txt = txt.slice(0, 200).trim()
  return txt.length >= 3 ? txt : null
}

/**
 * Turn "⚠️ GominPlanet Reviews ⚠️'s Amazon Page – Office & Studio Essentials …"
 * into "Office & Studio Essentials – Upgrade Your Workspace" — strip emoji, and
 * drop the "<handle>'s Amazon Page" prefix so we're left with the list's name.
 */
export function cleanListName(raw: string): string | null {
  let s = (raw || '')
    // Emoji, dingbats, arrows, warning signs, variation selectors, ZWJ.
    .replace(/[\u{1F000}-\u{1FAFF}\u{2190}-\u{21FF}\u{2300}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}\u{200D}]/gu, '')
    .replace(/\s+/g, ' ').trim()
  // Everything up to and including "Amazon Page" is the profile chrome — drop it.
  const ap = s.match(/Amazon Page/i)
  if (ap) s = s.slice((ap.index || 0) + ap[0].length)
  s = s.replace(/^['’]s\b/i, '').replace(/^[\s\-–—:|,]+/, '').trim()
  return s.length >= 3 ? s.slice(0, 140) : null
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n))
}
