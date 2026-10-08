// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// A shop tile always has a picture.
//
// A blank grey card sat at the top of a creator's Link in Bio page, which is the
// page a Pinterest pin had just sent someone to for that exact product. The tile
// was written correctly in every other respect: right title, right affiliate
// link, top of the list, ticked. It just had no image, because the deal path
// renders an art-directed vertical pin and hands it over as base64, so the
// plain product photo never reached the tile write.
//
// That is a small omission with an outsized effect. The tile is the whole
// payoff of the pin: someone arrives wanting the thing they saw, and the first
// card is grey.
//
// Two writers create these tiles (the pin path and the social path) and both
// had their own version of "use whatever image I happen to have". This is the
// one answer they now share, so a fix in it reaches both.

import { isYouTubeImage } from '@/lib/own-thumbnail'
import { fetchKeepaBasicsCached } from '@/lib/keepa-cache'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any

/** Caches that already hold a product photo keyed by ASIN, cheapest first. */
const IMAGE_CACHES = ['deal_radar_cache', 'amz_product_cache', 'storefront_catalog', 'keepa_product_cache'] as const

/** How long a page waits on Keepa for one missing photo before showing what it has. */
const KEEPA_WAIT_MS = 8_000

/**
 * Amazon's own image endpoint. No API key, no account: it 302s to the product's
 * primary photo. The last resort, and worth having, because a tile that might
 * show a broken image still beats one that is guaranteed to show nothing.
 */
export function amazonAsinImage(asin: string): string {
  return `https://ws-na.amazon-adsystem.com/widgets/q?_encoding=UTF8&ASIN=${encodeURIComponent(asin)}&Format=_SL500_&ID=AsinImage&MarketPlace=US&ServiceVersion=20070822&WS=1`
}

/**
 * The picture for a product tile.
 *
 * `preferred` is whatever the caller already has, and wins when it is a real
 * URL. Everything after it exists so that "the caller had nothing" stops
 * producing a blank card.
 *
 * Never throws and never returns empty for a valid ASIN: every failure falls
 * through to the next source, and the last source needs no network call to
 * construct.
 */
export async function tileImageFor(
  db: Db, asin: string | null | undefined, preferred?: string | null,
): Promise<string | null> {
  const given = String(preferred ?? '').trim()
  // NOT A YOUTUBE THUMBNAIL (Seb, 2026-10-08: a pin made from a video put a
  // broken picture on the shop page). For a video still private or scheduled,
  // YouTube hands out a signed thumbnail link that stops working, and a
  // product tile is better served by the product's own photo anyway.
  if (/^https?:\/\//i.test(given) && !isYouTubeImage(given)) return given

  const a = String(asin ?? '').trim().toUpperCase()
  if (!/^[A-Z0-9]{10}$/.test(a)) return null

  return (await cachedProductImage(db, a)) ?? (await keepaProductImage(db, a)) ?? amazonAsinImage(a)
}

/**
 * IS AMAZON'S IMAGE WIDGET, which is a guess, not a picture. For a new product
 * it gives nothing at all (Seb, 2026-10-08: the LEVEL8 card a pin sent people
 * to was blank), so a tile holding it is treated as a tile with no picture.
 */
export function isAmazonWidgetImage(url: string | null | undefined): boolean {
  return /amazon-adsystem\.com\/widgets\/q\b/i.test(String(url ?? ''))
}

/** The product's main photo from Keepa (through MVP's shared Keepa cache), or
 *  null when Keepa has none or does not answer in time. */
export async function keepaProductImage(db: Db, asin: string): Promise<string | null> {
  try {
    const got = await Promise.race([
      fetchKeepaBasicsCached(db, [asin]),
      new Promise<null>((r) => setTimeout(() => r(null), KEEPA_WAIT_MS)),
    ])
    const url = String(got?.get(asin)?.imageUrl ?? '').trim()
    return /^https?:\/\//i.test(url) && !isYouTubeImage(url) && !isAmazonWidgetImage(url) ? url : null
  } catch {
    return null
  }
}

/** The product's photo from MVP's own caches, or null. */
export async function cachedProductImage(db: Db, asin: string): Promise<string | null> {
  for (const table of IMAGE_CACHES) {
    try {
      const { data } = await db.from(table).select('image_url').eq('asin', asin).limit(1).maybeSingle()
      const url = String(data?.image_url ?? '').trim()
      if (/^https?:\/\//i.test(url) && !isYouTubeImage(url) && !isAmazonWidgetImage(url)) return url
    } catch {
      // A cache table that does not exist on this database is not a reason to
      // give up on finding a picture.
    }
  }
  return null
}

/**
 * MENDS TILES WHOSE PICTURE IS A YOUTUBE THUMBNAIL, AMAZON'S WIDGET, OR NONE,
 * when a shop page is drawn (Seb, 2026-10-08: the LEVEL8 card still showed
 * nothing after the first fix. The pin had saved the widget link on the tile,
 * the widget gives nothing for a new product, and a widget link looked like a
 * real picture so the tile was skipped). In order: the product's photo from
 * MVP's caches, then from Keepa (a few per page view, so a page with many
 * blank cards still draws quickly), then the thumbnail MVP made for the
 * creator's video of it. A real picture found is saved on the tile, so this
 * happens once per tile.
 */
export async function healShopTiles<T extends { id: string; image_url: string | null; asin: string | null }>(
  db: Db, userId: string, items: T[], max = 12, keepaMax = 3,
): Promise<T[]> {
  let left = max
  let keepaLeft = keepaMax
  const out: T[] = []
  for (const it of items) {
    const u = String(it.image_url ?? '').trim()
    const a = String(it.asin ?? '').trim().toUpperCase()
    const needs = (!/^https?:\/\//i.test(u) || isYouTubeImage(u) || isAmazonWidgetImage(u)) && /^[A-Z0-9]{10}$/.test(a)
    if (!needs || left <= 0) { out.push(it); continue }
    left--
    let found = await cachedProductImage(db, a)
    if (!found && keepaLeft > 0) { keepaLeft--; found = await keepaProductImage(db, a) }
    if (!found) {
      try {
        const { data } = await db.from('launch_items').select('thumbnail_url').eq('user_id', userId).eq('asin', a)
          .not('thumbnail_url', 'is', null).order('created_at', { ascending: false }).limit(1).maybeSingle()
        const t = String(data?.thumbnail_url ?? '').trim()
        if (/^https?:\/\//i.test(t) && !isYouTubeImage(t)) found = t
      } catch { /* no Liftoff video for it */ }
    }
    if (!found) {
      try {
        const { data } = await db.from('youtube_videos').select('thumbnail_url').eq('user_id', userId).eq('asin', a)
          .not('thumbnail_url', 'is', null).order('created_at', { ascending: false }).limit(1).maybeSingle()
        const t = String(data?.thumbnail_url ?? '').trim()
        if (/^https?:\/\//i.test(t) && !isYouTubeImage(t)) found = t
      } catch { /* no video of it with an MVP-made thumbnail */ }
    }
    if (found) {
      try { await db.from('link_page_items').update({ image_url: found }).eq('id', it.id) } catch { /* shown now, saved next time */ }
      out.push({ ...it, image_url: found })
    } else out.push(it)
  }
  return out
}

/**
 * The picture a shop page shows for a tile, at render time. A tile saved with
 * a YouTube thumbnail before the rule above shows the product's own photo
 * instead, so the cards already on a page are fixed without rewriting them.
 */
export function shopTileImage(imageUrl: string | null | undefined, asin: string | null | undefined): string | null {
  const u = String(imageUrl ?? '').trim()
  const a = String(asin ?? '').trim().toUpperCase()
  if (/^https?:\/\//i.test(u) && !isYouTubeImage(u)) return u
  if (/^[A-Z0-9]{10}$/.test(a)) return amazonAsinImage(a)
  return /^https?:\/\//i.test(u) ? u : null
}
