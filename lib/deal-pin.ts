// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// Publish ONE Deal Radar deal to Pinterest as a properly designed pin.
//
// Pinterest is deliberately NOT part of the deal "quick post" pipeline: a pin
// must link to a real destination (not a bare affiliate link in a caption) and
// wants a designed vertical image, not the square deal card. So a deal pin
// reuses the Amazon-Influencer pin path instead — it designs a 2:3 Art Director
// pin from the product photo, then publishes via publishAmazonPin, which points
// the pin at the creator's geni.us affiliate link (MVP-PINTEREST group), writes
// the copy, guarantees the FTC disclosure + #ad #sponsored, picks the board, and
// heals a stale sandbox board. No blog post required.
import { generateArtDirectorPin } from '@/lib/art-director-pin'
import { publishAmazonPin, type PinIntegration } from '@/lib/amazon-pin-publish'
import type { Tier } from '@/lib/tier'

export interface DealPinResult {
  ok: boolean
  url?: string
  error?: string
  /** Soft note (e.g. Geniuslink hiccup, or which page the pin points at) — the
   *  pin still published. */
  note?: string | null
  /** The pin was refused ONLY because there is no page of the creator's to
   *  point at. One setup step from working, so the caller offers the step. */
  needsLinkPage?: boolean
  setupPath?: string
}

/**
 * Design + publish a deal pin. Best-effort on the design step: if the Art
 * Director render fails, we fall back to pinning the raw product photo so the
 * post still goes out. Throws nothing — returns a per-pin result the caller
 * pushes alongside the other platform results.
 */
export async function publishDealPin(opts: {
  userId: string
  tier: Tier
  intRow: PinIntegration | null
  asin: string
  title: string
  /** The deal's product photo — reference for the design and the fallback pin. */
  productImageUrl: string | null
  /** When set (Passport Links on), pin THIS link instead of resolving a tag/geni.us
   *  one — the geo-routing link. Null → normal resolution. */
  linkOverride?: string | null
}): Promise<DealPinResult> {
  const intRow = opts.intRow
  if (!intRow?.pinterest_access_token) {
    return { ok: false, error: 'Pinterest is not connected.' }
  }
  if (!opts.productImageUrl) {
    return { ok: false, error: 'This deal has no product image to build a pin from.' }
  }

  // Design the vertical pin from the product photo. Base64 back — no hosting.
  const designed = await generateArtDirectorPin({
    productImageUrl: opts.productImageUrl,
    productTitle: opts.title,
    userId: opts.userId,
    tier: opts.tier,
  }).catch(() => null)

  try {
    const pin = await publishAmazonPin({
      userId: opts.userId,
      tier: opts.tier,
      intRow,
      asin: opts.asin,
      productTitle: opts.title,
      // The product photo for the shop tile. Separate from the pin image on
      // purpose: when the art-directed pin renders, it is passed as base64 and
      // imageUrl is empty, which is how the tile ended up a blank grey card.
      tileImageUrl: opts.productImageUrl,
      // Prefer the designed pin; fall back to the raw product photo if the
      // render failed so the deal still gets pinned.
      ...(designed
        ? { imageBase64: designed.data, imageMediaType: designed.mediaType }
        : { imageUrl: opts.productImageUrl }),
      linkOverride: opts.linkOverride,
    })
    return { ok: true, url: pin.pinUrl, note: pin.geniuslinkNote }
  } catch (err) {
    // A pin refused only because the creator has no page to point at is not a
    // failure to report and move on from; it is one setup step away from
    // working. Pass that through so the caller can offer the step.
    const e = err as Error & { needsLinkPage?: boolean; setupPath?: string }
    return {
      ok: false,
      error: e instanceof Error ? e.message : 'Could not publish the pin.',
      ...(e?.needsLinkPage ? { needsLinkPage: true, setupPath: e.setupPath || '/link-in-bio' } : {}),
    }
  }
}
