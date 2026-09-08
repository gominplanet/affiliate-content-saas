// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// Client-only Meta (Facebook) Pixel helper. The base pixel + PageView load
// site-wide from app/layout.tsx (production only). This fires STANDARD conversion
// events at the real funnel moments so Meta ads can optimize for conversions.
//
// Safe to call anywhere on the client: if the pixel isn't loaded (dev/preview,
// an ad blocker, consent not granted) it silently no-ops.

type Fbq = (...args: unknown[]) => void

/**
 * Fire a Meta standard event (e.g. 'Purchase', 'CompleteRegistration').
 *
 * Pass `eventId` for anything the server ALSO reports through the Conversions
 * API (see lib/meta-capi.ts). Meta collapses a browser event and a server
 * event sharing an id into one conversion; without it the same sale is
 * counted twice and every cost-per-acquisition number reads half of reality.
 */
export function trackMeta(event: string, params?: Record<string, unknown>, eventId?: string): void {
  if (typeof window === 'undefined') return
  try {
    const fbq = (window as unknown as { fbq?: Fbq }).fbq
    if (typeof fbq !== 'function') return
    if (eventId) fbq('track', event, params, { eventID: eventId })
    else fbq('track', event, params)
  } catch { /* pixel absent / blocked → no-op */ }
}
