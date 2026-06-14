/**
 * "Get it now" CTA-card thumbnail helpers.
 *
 * The shared blog-writer template (services/claude) hard-codes a YouTube
 * thumbnail (<img …/{VIDEO_ID}/…>) inside the CTA card. That's correct for
 * video-based reviews, but CAMPAIGN posts have no video — so the thumb renders
 * as a broken image. These helpers let the campaign publish + refresh paths
 * swap that thumb for the generated hero image, or remove it entirely when
 * there's no hero.
 */

// Matches the CTA card's product thumbnail <img>, regardless of attribute order.
const CTA_THUMB_IMG = /<img\b[^>]*class="gr-cta-thumb"[^>]*>/gi

/** Point every CTA thumb at `url` (the generated hero image). */
export function setCtaThumb(html: string, url: string): string {
  return html.replace(CTA_THUMB_IMG, `<img src="${url}" alt="" loading="lazy" class="gr-cta-thumb" />`)
}

/** Remove the CTA thumb wrapper. The CSS `:has(.gr-cta-thumb-wrap)` grid
 *  collapses back to a single column on its own, so the card stays clean. */
export function stripCtaThumb(html: string): string {
  return html.replace(/<div class="gr-cta-thumb-wrap">[\s\S]*?<\/div>/gi, '')
}
