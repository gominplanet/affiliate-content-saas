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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any

/** Caches that already hold a product photo keyed by ASIN, cheapest first. */
const IMAGE_CACHES = ['deal_radar_cache', 'amz_product_cache', 'storefront_catalog'] as const

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
  if (/^https?:\/\//i.test(given)) return given

  const a = String(asin ?? '').trim().toUpperCase()
  if (!/^[A-Z0-9]{10}$/.test(a)) return null

  for (const table of IMAGE_CACHES) {
    try {
      const { data } = await db.from(table).select('image_url').eq('asin', a).limit(1).maybeSingle()
      const url = String(data?.image_url ?? '').trim()
      if (/^https?:\/\//i.test(url)) return url
    } catch {
      // A cache table that does not exist on this database is not a reason to
      // give up on finding a picture.
    }
  }

  return amazonAsinImage(a)
}
