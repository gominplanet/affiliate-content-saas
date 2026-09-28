// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// Which products an Amazon video sells, read off the video's public page.
//
// WHY THIS AND NOT THE PRODUCT PAGES. Amazon's video list (Manage content)
// gives every video's id but not its products, and no per-video call could be
// found to replay. Looking each product up on its own page worked, but one
// page at a time in the creator's browser: a tab per product, 15 seconds each,
// which for a library of 7,000 videos is more than a day of Chrome flashing
// tabs. Every video, though, has a public page at amazon.com/vdp/<id>, where
// <id> is the hex part of the video's id (amzn1.vse.video.<id>). The page is
// rendered on Amazon's server, needs no sign-in, answers in under a second,
// and names the products under the video in its own data:
//
//   "id":"<id>", ... "carouselItems":["B0GL85L61L"], "vendorTrackingId":"...-20"
//
// Other ASINs appear on the page (recommendations), so only the carousel of
// the object carrying this video's id counts, with the page's own
// {"asin":..,"contentSeedId":"<id>"} attribute as a second reading.

export const VDP_ID_RE = /^[0-9a-f]{32}$/

/** amzn1.vse.video.<32 hex> to the id the public page uses. */
export function vdpIdFromAci(aci: string | null | undefined): string | null {
  const m = /^amzn1\.vse\.video\.([0-9a-f]{32})$/i.exec(String(aci || '').trim())
  return m ? m[1].toLowerCase() : null
}

export type VdpRead =
  | { state: 'ok'; asins: string[]; trackingId: string | null; title: string | null }
  | { state: 'no-products' }   // the page loaded and names no product for this video
  | { state: 'not-found' }     // Amazon has no page for this video (removed, or never public)
  | { state: 'blocked' }       // Amazon answered with a robot check, not the page

const ASIN = /^[A-Z0-9]{10}$/

/** Pure: read one video page's HTML. */
export function parseVdpPage(html: string, vdpId: string): VdpRead {
  const raw = String(html || '')
  if (/validateCaptcha|Type the characters you see|api-services-support@amazon\.com|To discuss automated access/i.test(raw)) return { state: 'blocked' }
  // The data sits in JSON strings inside the page, escaped once (\") or as
  // HTML entities (&#034;). Both are undone before reading.
  const t = raw.replace(/\\"/g, '"').replace(/&#034;|&quot;/g, '"').replace(/\\\//g, '/')
  const id = vdpId.toLowerCase()
  if (t.indexOf(id) === -1) return { state: 'not-found' }

  const found = new Set<string>()
  // 1. The carousel nearest this video's own "id".
  const idAt: number[] = []
  for (const m of t.matchAll(new RegExp(`"id":"${id}"`, 'g'))) if (m.index != null) idAt.push(m.index)
  const carousels = [...t.matchAll(/"carouselItems":\[([^\]]*)\]/g)].map((m) => ({ at: m.index ?? 0, list: m[1] }))
  if (idAt.length && carousels.length) {
    let best: { at: number; list: string } | null = null, dist = Infinity
    for (const c of carousels) for (const i of idAt) { const d = Math.abs(c.at - i); if (d < dist) { dist = d; best = c } }
    // Same object only: a carousel thousands of characters away belongs to
    // another video on the page.
    if (best && dist < 6000) for (const m of best.list.matchAll(/"([A-Z0-9]{10})"/g)) found.add(m[1])
  }
  // 2. The page's own pairing of this video with its product.
  for (const m of t.matchAll(new RegExp(`"asin":"([A-Z0-9]{10})","contentSeedId":"${id}"`, 'g'))) found.add(m[1])
  for (const m of t.matchAll(new RegExp(`"contentSeedId":"${id}","asin":"([A-Z0-9]{10})"`, 'g'))) found.add(m[1])

  const asins = [...found].filter((a) => ASIN.test(a))
  if (!asins.length) return { state: 'no-products' }
  const tracking = /"vendorTrackingId":"([^"]{3,60})"/.exec(t)
  const title = /<title>\s*(?:Watch\s+)?([^<]*?)(?:\s+on Amazon Live)?\s*<\/title>/i.exec(raw)
  return { state: 'ok', asins, trackingId: tracking ? tracking[1] : null, title: title ? title[1].trim().slice(0, 200) : null }
}

export const VDP_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36'

/** Fetch and read one video page. Network failure is 'error', never a
 *  claim about the video. */
export async function readVdp(vdpId: string, timeoutMs = 12_000): Promise<VdpRead | { state: 'error'; detail: string }> {
  try {
    const res = await fetch(`https://www.amazon.com/vdp/${vdpId}`, {
      headers: { 'User-Agent': VDP_UA, 'Accept-Language': 'en-US,en;q=0.9', Accept: 'text/html,application/xhtml+xml' },
      redirect: 'follow',
      signal: AbortSignal.timeout(timeoutMs),
    })
    if (res.status === 404 || res.status === 410) return { state: 'not-found' }
    if (res.status === 503 || res.status === 429) return { state: 'blocked' }
    if (!res.ok) return { state: 'error', detail: `HTTP ${res.status}` }
    return parseVdpPage(await res.text(), vdpId)
  } catch (e) {
    return { state: 'error', detail: e instanceof Error ? e.message : String(e) }
  }
}
