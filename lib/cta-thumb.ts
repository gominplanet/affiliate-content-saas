/**
 * "Get it now" CTA-card thumbnail helpers.
 *
 * The shared blog-writer template (services/claude) hard-codes a YouTube
 * thumbnail (<img …/{VIDEO_ID}/…>) inside the CTA card. That's correct for
 * video-based reviews, but CAMPAIGN / PartnerBoost posts have no video — and
 * the writer, told "there is no video", inconsistently EITHER keeps that
 * <img> with a broken {VIDEO_ID} src OR drops the thumb element entirely.
 *
 * `setCtaThumb` therefore INSERTS-OR-REPLACES so the CTA box ALWAYS carries an
 * image (an absolute rule): if the thumb <img> exists we swap its src; if the
 * writer dropped it we re-inject the wrapper. `stripCtaThumb` is the last
 * resort only when we genuinely have no image to show.
 */

// Matches the CTA card's product thumbnail <img>, regardless of attribute order.
const CTA_THUMB_IMG = /<img\b[^>]*class="gr-cta-thumb"[^>]*>/gi
// The CTA card's text column. Its children are <p>/<a> (no nested <div>), so a
// non-greedy match to the first </div> is the body's own close.
const CTA_BODY_BLOCK = /<div class="gr-cta-body">[\s\S]*?<\/div>/i
const CTA_CARD_OPEN = /<div class="gr-cta-card">/i

/**
 * Point the CTA thumb at `url` (the generated hero / product photo), inserting
 * the thumb wrapper if the writer omitted it. The `:has(.gr-cta-thumb-wrap)`
 * grid lights up automatically once the wrapper is present.
 */
export function setCtaThumb(html: string, url: string): string {
  const img = `<img src="${url}" alt="" loading="lazy" class="gr-cta-thumb" />`
  const wrap = `<div class="gr-cta-thumb-wrap">${img}</div>`

  // 1. A thumb already exists (incl. a broken {VIDEO_ID} one) → swap its src.
  //    Function replacement avoids `$` in the URL being read as a backref.
  if (html.includes('class="gr-cta-thumb"')) {
    return html.replace(CTA_THUMB_IMG, () => img)
  }
  // 2. Writer dropped the thumb → inject the wrap as the card's 2nd child
  //    (right after the text body) so it lands in the 220px grid column.
  if (CTA_BODY_BLOCK.test(html)) {
    return html.replace(CTA_BODY_BLOCK, (m) => `${m}\n    ${wrap}`)
  }
  // 3. Body div was flattened but the card exists → inject after the card open
  //    so the image still renders.
  if (CTA_CARD_OPEN.test(html)) {
    return html.replace(CTA_CARD_OPEN, (m) => `${m}\n    ${wrap}`)
  }
  // 4. No CTA card at all → nothing to do.
  return html
}

/** Remove the CTA thumb wrapper. The CSS `:has(.gr-cta-thumb-wrap)` grid
 *  collapses back to a single column on its own, so the card stays clean.
 *  Last resort only — used when there is genuinely no image to show. */
export function stripCtaThumb(html: string): string {
  return html.replace(/<div class="gr-cta-thumb-wrap">[\s\S]*?<\/div>/gi, '')
}
