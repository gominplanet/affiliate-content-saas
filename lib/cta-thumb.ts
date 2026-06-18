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
  // Self-contained + modest. The img drops the `gr-cta-thumb` class on purpose:
  // that class pulls a 16:9 `object-fit:cover` crop from the writer's stylesheet,
  // which (a) is dropped on video-less posts and (b) crops square product photos
  // oddly. Inline-only here → a tidy ≤180px natural-aspect thumb, centred when
  // the card stacks (no stylesheet) and contained in the 220px column when the
  // grid IS present. Keeps the wrapper class so the `:has()` grid still triggers.
  return (
    `<div class="gr-cta-thumb-wrap" style="max-width:180px;align-self:center;margin:4px auto 0;border:2px solid #111;border-radius:4px;overflow:hidden;line-height:0">` +
    `<img src="${url}" alt="" loading="lazy" style="display:block;width:100%;height:auto;object-fit:contain" />` +
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

// ── Fully self-contained CTA card (campaign / video-less posts) ───────────────
//
// The writer's `.gr-cta-card` relies on the post's <style> block for its
// 2-column grid + button styling. VIDEO-LESS posts (campaign / PartnerBoost /
// Levanta) drop that <style> block, and the model doesn't reliably reproduce
// the inline styles — so the card collapses to a plain link with the image
// stacked underneath. For those routes we REBUILD the card deterministically
// with everything inline (layout + retailer-colored button + image on the
// right), so it renders identically with or without a stylesheet.

export interface CtaCardOpts {
  productName: string
  url: string
  /** Retailer label for the button copy + color: 'Amazon' (yellow), 'Walmart'
   *  (blue), 'LTK' (dark), or null for a neutral dark button. */
  retailerLabel?: string | null
  /** Override the whole button label (e.g. "Shop it on LTK →"). When omitted it's
   *  derived from retailerLabel ("Get the best price on {retailer} →"). */
  buttonLabel?: string
  imageUrl?: string | null
  disclaimer?: string
}

/** Find the balanced `<div class="gr-cta-card">…</div>` (it nests gr-cta-body /
 *  gr-cta-thumb-wrap divs, so a non-greedy match won't do). Returns [start,end)
 *  offsets or null. */
function findCtaCardBlock(html: string): [number, number] | null {
  const m = /<div\b[^>]*class="[^"]*\bgr-cta-card\b[^"]*"[^>]*>/i.exec(html)
  if (!m) return null
  const start = m.index
  let depth = 1
  const re = /<div\b|<\/div>/gi
  re.lastIndex = m.index + m[0].length
  let t: RegExpExecArray | null
  while ((t = re.exec(html))) {
    depth += t[0].toLowerCase() === '</div>' ? -1 : 1
    if (depth === 0) return [start, t.index + t[0].length]
  }
  return null
}

/** Pull the affiliate URL out of an existing CTA card's button — so a repair
 *  pass can rebuild the card without losing the (already-cloaked) link. Returns
 *  null if there's no card or no link. */
export function extractCtaCardUrl(html: string): string | null {
  const block = findCtaCardBlock(html)
  if (!block) return null
  const seg = html.slice(block[0], block[1])
  const m = /<a\b[^>]*\bhref="([^"]+)"/i.exec(seg)
  return m ? m[1] : null
}

/**
 * Replace the post's CTA card with a self-contained, inline-styled one. The
 * button color + copy follow the retailer (Walmart → blue, Amazon → yellow,
 * other → dark). The image sits in a fixed right column that wraps below on
 * narrow screens (pure flexbox — no stylesheet or `:has()` needed). If there's
 * no card to replace, returns the html unchanged.
 */
export function rebuildCtaCard(html: string, opts: CtaCardOpts): string {
  const block = findCtaCardBlock(html)
  if (!block) return html

  const label = (opts.retailerLabel || '').trim()
  const isWalmart = /walmart/i.test(label)
  const isAmazon = /amazon/i.test(label)
  const btnBg = isWalmart ? '#0071DC' : isAmazon ? '#FFC200' : '#111'
  const btnColor = isWalmart ? '#ffffff' : isAmazon ? '#111' : '#ffffff'
  const buttonLabel = opts.buttonLabel?.trim()
    || (label ? `Get the best price on ${label} →` : 'Get the best price today →')
  const disclaimer = (opts.disclaimer || '').trim()
    || 'This post contains affiliate links. I may earn a commission at no extra cost to you.'
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

  const imgCol = opts.imageUrl
    ? `<div style="flex:0 0 200px;max-width:200px;align-self:center;line-height:0;border-radius:4px;overflow:hidden;border:2px solid #111">` +
      `<img src="${opts.imageUrl}" alt="" loading="lazy" style="display:block;width:100%;height:auto;object-fit:contain" /></div>`
    : ''

  // NOTE: flex-direction:row is set EXPLICITLY — the post's own <style> block
  // defines `.gr-cta-card{flex-direction:column}`, and since we keep the
  // gr-cta-card class (the WP plugin uses it as a "skip this region" marker for
  // image/newsletter injection), that rule would otherwise stack the image
  // BELOW the text. Inline wins over the stylesheet, keeping text|image side by
  // side (wraps to stacked only on a genuinely narrow column).
  const card =
    `<div class="gr-cta-card" style="background:#f8f9fa;border:2px solid #111;border-radius:4px;padding:24px 28px;margin:32px 0;display:flex;flex-direction:row;gap:24px;align-items:center;flex-wrap:wrap">` +
      `<div class="gr-cta-body" style="flex:1 1 260px;min-width:0;display:flex;flex-direction:column;gap:14px">` +
        `<p style="font-size:11px;font-weight:800;letter-spacing:1.5px;text-transform:uppercase;color:#111;margin:0;padding-bottom:12px;border-bottom:2px solid #FFC200">Get it now</p>` +
        `<p style="font-size:20px;font-weight:800;color:#111;margin:0;line-height:1.3;letter-spacing:-.3px">${esc(opts.productName)}</p>` +
        `<a href="${opts.url}" target="_blank" rel="noopener sponsored nofollow" style="display:flex;align-items:center;justify-content:center;gap:10px;background:${btnBg};color:${btnColor};font-size:15px;font-weight:800;letter-spacing:.5px;text-transform:uppercase;padding:18px 24px;border-radius:3px;text-decoration:none;margin-top:4px;width:100%;box-sizing:border-box">${esc(buttonLabel)}</a>` +
        `<p style="font-size:10px;line-height:1.4;color:#6b6b70;margin:6px 0 0;font-style:italic">${esc(disclaimer)}</p>` +
      `</div>` +
      imgCol +
    `</div>`

  return html.slice(0, block[0]) + card + html.slice(block[1])
}

/**
 * Embed the creator's LTK "Shop the Post" widget (the HTML snippet LTK generates
 * for WordPress) as the shoppable section. LTK provides this code expressly for
 * WordPress, so it's pasted through verbatim — we never modify or scrub it. It's
 * wrapped in a Gutenberg `wp:html` block (so the editor keeps it intact) with a
 * heading + affiliate disclaimer, and REPLACES the synthetic CTA-button card if
 * one exists (the live widget is the better call-to-action); otherwise it's
 * appended to the end of the post.
 *
 * NOTE: the widget is a <script>. WordPress strips scripts on save for accounts
 * without the `unfiltered_html` capability — fine for self-hosted admins, but it
 * may not render on locked-down roles/hosts. The text-link CTA is the fallback.
 */
export function embedLtkWidget(html: string, widgetHtml: string): string {
  const w = (widgetHtml || '').trim()
  if (!w) return html
  const block =
    `<!-- wp:html -->\n` +
    `<div class="ltk-shop-widget" style="margin:32px 0">` +
    `<p style="font-size:11px;font-weight:800;letter-spacing:1.5px;text-transform:uppercase;color:#111;margin:0 0 16px;padding-bottom:12px;border-bottom:2px solid #FFC200">Shop this post on LTK</p>` +
    w +
    `<p style="font-size:10px;line-height:1.4;color:#6b6b70;margin:14px 0 0;font-style:italic">This post contains affiliate links. I may earn a commission at no extra cost to you.</p>` +
    `</div>\n` +
    `<!-- /wp:html -->`
  const range = findCtaCardBlock(html)
  if (range) return html.slice(0, range[0]) + block + html.slice(range[1])
  return `${html}\n${block}`
}
