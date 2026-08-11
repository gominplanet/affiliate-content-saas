// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// Shared "deal card" builder for the Quick post to socials flows (Deal Radar,
// Walmart, Wayward). Turns a bare product photo into a designed square offer
// card via Cloudinary (product + a bold qualitative hook + optional brand chip),
// so the image on Facebook / Threads / LinkedIn / Telegram / Bluesky reads like
// a promoted deal, not a catalog photo. Cheap (a Cloudinary transform, no AI),
// so it's safe on every post including scheduled bulk blasts.
//
// Best-effort: returns null when Cloudinary isn't configured or the render
// fails, and the caller falls back to the raw product photo.
import { renderDealCard, cloudinaryConfigured } from '@/services/cloudinary'

/** A qualitative deal hook — never a specific % or price, because the post is
 *  evergreen and the number changes (same rule the deal caption follows). */
export function dealCardHeadline(
  dealQuality?: string | null,
  lowestLabel?: string | null,
  discountPct?: number | null,
): string {
  const q = (dealQuality || '').toLowerCase()
  const low = (lowestLabel || '').toLowerCase()
  if (q === 'excellent') return 'HOT DEAL'
  if (/lowest|all[- ]?time|best price|record/.test(low)) return 'LOWEST PRICE'
  if (typeof discountPct === 'number' && discountPct >= 30) return 'BIG SAVINGS'
  return 'ON SALE NOW'
}

/**
 * Build the designed deal-card image URL, or null to fall back to the raw photo.
 * `imageUrl` is the product photo; the rest are optional signals used for the
 * hook + supporting line + brand chip.
 */
export async function buildDealCardImage(
  imageUrl: string | null | undefined,
  signals: {
    dealQuality?: string | null
    lowestLabel?: string | null
    discountPct?: number | null
    brandName?: string | null
    logoUrl?: string | null
    /** Override the computed hook — e.g. "TOP PICK" for a product share that
     *  isn't a discount (Wayward), so we never claim "ON SALE" falsely. */
    headline?: string | null
  } = {},
): Promise<string | null> {
  if (!imageUrl || !cloudinaryConfigured()) return null
  const headline = (signals.headline || '').trim()
    || dealCardHeadline(signals.dealQuality, signals.lowestLabel, signals.discountPct)
  // Only use the lowest-price label as a supporting line — a short, evergreen
  // phrase like "Lowest in 90 days". Skip anything with a raw number/price.
  const subline = (signals.lowestLabel || '').trim().slice(0, 40) || undefined
  return renderDealCard(imageUrl, {
    headline,
    subline,
    brandName: signals.brandName || undefined,
    logoUrl: signals.logoUrl || undefined,
  })
}
