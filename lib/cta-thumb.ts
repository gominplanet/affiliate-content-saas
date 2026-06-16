/**
 * "Get it now" CTA-card thumbnail helpers.
 *
 * The shared blog-writer template (services/claude) bundles the CTA card's
 * sizing CSS (.gr-cta-thumb width/aspect-ratio + the 1fr/220px grid) inside the
 * VIDEO-EMBED <style> block. CAMPAIGN / PartnerBoost posts are told "there is
 * no video", so the writer drops that block AND its CSS — leaving the thumb
 * <img> with no size constraint (it renders full-size). It also inconsistently
 * keeps a broken {VIDEO_ID} thumb or drops the thumb element entirely.
 *
 * So `setCtaThumb` writes a fully self-contained, INLINE-STYLED thumb wrapper
 * (sized + bordered without any stylesheet) and INSERTS it if the writer left
 * none — guaranteeing the CTA box always carries a correctly-sized image (an
 * absolute rule). `stripCtaThumb` is the last resort when there's no image.
 */

// A self-contained thumb wrapper: inline-styled so it sizes correctly even when
// the post never shipped the .gr-cta-* stylesheet. max-width caps it in plain
// block flow; in the grid (when the CSS *is* present) the 220px column wins.
function thumbWrap(url: string): string {
  return (
    `<div class="gr-cta-thumb-wrap" style="max-width:240px;align-self:center;border:2px solid #111;border-radius:4px;overflow:hidden;line-height:0">` +
    `<img src="${url}" alt="" loading="lazy" class="gr-cta-thumb" style="display:block;width:100%;height:auto" />` +
    `</div>`
  )
}

// The existing thumb wrapper (whatever the writer emitted), its bare <img>, the
// text column, and the card open — tried in that order.
const CTA_WRAP = /<div class="gr-cta-thumb-wrap">[\s\S]*?<\/div>/i
const CTA_THUMB_IMG = /<img\b[^>]*class="gr-cta-thumb"[^>]*>/i
const CTA_BODY_BLOCK = /<div class="gr-cta-body">[\s\S]*?<\/div>/i
const CTA_CARD_OPEN = /<div class="gr-cta-card">/i

/**
 * Point the CTA thumb at `url`, replacing whatever the writer emitted with a
 * self-sized wrapper — and inserting one if the writer dropped the thumb.
 * Function replacements avoid `$` in the URL being read as a backref.
 */
export function setCtaThumb(html: string, url: string): string {
  const wrap = thumbWrap(url)
  // 1. A full thumb wrapper exists (incl. a broken {VIDEO_ID} one) → replace it.
  if (CTA_WRAP.test(html)) return html.replace(CTA_WRAP, () => wrap)
  // 2. A bare thumb <img> with no wrapper → swap it for the wrapper.
  if (CTA_THUMB_IMG.test(html)) return html.replace(CTA_THUMB_IMG, () => wrap)
  // 3. Writer dropped the thumb → inject after the text body (2nd grid column).
  if (CTA_BODY_BLOCK.test(html)) return html.replace(CTA_BODY_BLOCK, (m) => `${m}\n    ${wrap}`)
  // 4. Body div was flattened but the card exists → inject after the card open.
  if (CTA_CARD_OPEN.test(html)) return html.replace(CTA_CARD_OPEN, (m) => `${m}\n    ${wrap}`)
  // 5. No CTA card at all → nothing to do.
  return html
}

/** Remove the CTA thumb wrapper. The CSS `:has(.gr-cta-thumb-wrap)` grid
 *  collapses back to a single column on its own, so the card stays clean.
 *  Last resort only — used when there is genuinely no image to show. */
export function stripCtaThumb(html: string): string {
  return html.replace(/<div class="gr-cta-thumb-wrap">[\s\S]*?<\/div>/gi, '')
}
