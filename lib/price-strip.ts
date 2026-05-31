/**
 * Inject a high-contrast affiliate CTA strip immediately after the Quick
 * Verdict block in a generated blog post.
 *
 * Why post-process instead of asking the model to render it:
 *   - Deterministic placement (we know exactly where it lands)
 *   - Easier to A/B test colors / copy without re-prompting
 *   - No risk of the model forgetting it, mangling the URL, or shifting it
 *   - The strip styling can evolve independently of the article HTML
 *
 * The strip is the single highest-intent click target on the page: it shows
 * right under the verdict, before the reader has to scroll or skim the body.
 * Visual rules: gradient (Amazon orange when Amazon-bound, brand blue
 * otherwise), full width, large readable button copy, transparent
 * disclaimer line below in small text.
 */

export interface PriceStripOptions {
  /** Final affiliate URL the strip should link to. */
  affiliateUrl: string
  /** True when the destination is amazon.* — drives copy + colors + disclaimer. */
  isAmazon: boolean
  /**
   * Optional product name for the strip body. When provided we show
   * "Check Today's Price on Amazon for {productName} →" — more specific,
   * better for SEO/relevance. Falls back to the generic copy otherwise.
   */
  productName?: string | null
}

/**
 * Build the CTA strip HTML — fully inline-styled so it renders identically
 * regardless of theme CSS. Designed for a WordPress raw HTML block.
 */
export function renderPriceStrip(opts: PriceStripOptions): string {
  const url = opts.affiliateUrl.trim()
  if (!url) return ''
  const productName = (opts.productName || '').trim()

  // Copy + colors branch on Amazon vs. direct brand.
  const buttonLabel = opts.isAmazon
    ? productName
      ? `🛒 Check Today's Price on Amazon for ${productName} →`
      : `🛒 Check Today's Price on Amazon →`
    : productName
      ? `🔗 Get ${productName} — Best Price Today →`
      : `🔗 Get The Best Price Today →`

  const disclaimer = opts.isAmazon
    ? 'Clicking takes you to Amazon. As an Amazon Associate we earn from qualifying purchases — pricing and availability subject to change.'
    : 'Clicking takes you to the seller\'s website. We may earn a small commission if you purchase, at no extra cost to you.'

  // Amazon orange gradient when Amazon; brand blue gradient otherwise.
  const gradient = opts.isAmazon
    ? 'linear-gradient(135deg,#FF9900 0%,#FF6B00 100%)'
    : 'linear-gradient(135deg,#0071e3 0%,#0056b3 100%)'
  const shadow = opts.isAmazon
    ? '0 6px 18px rgba(255,107,0,.28)'
    : '0 6px 18px rgba(0,113,227,.28)'

  // WordPress raw HTML block — survives Gutenberg + classic editor round-trips.
  return [
    '<!-- wp:html -->',
    '<div class="gr-price-strip" style="margin:8px 0 28px">',
    `  <a href="${escapeHtml(url)}" target="_blank" rel="noopener sponsored nofollow" class="gr-price-strip-btn" style="display:flex;align-items:center;justify-content:center;text-align:center;gap:10px;background:${gradient};color:#fff;font-size:17px;font-weight:800;letter-spacing:.3px;line-height:1.3;padding:18px 22px;border-radius:8px;text-decoration:none;width:100%;box-sizing:border-box;box-shadow:${shadow};transition:transform .15s ease,box-shadow .15s ease">`,
    `    ${escapeHtml(buttonLabel)}`,
    '  </a>',
    `  <p class="gr-price-strip-note" style="font-size:11px;line-height:1.4;color:#86868b;text-align:center;margin:8px 0 0;font-style:italic">${escapeHtml(disclaimer)}</p>`,
    '</div>',
    '<!-- /wp:html -->',
  ].join('\n')
}

/**
 * Inject the strip into `content` immediately after the Quick Verdict block.
 * Returns the content unchanged when:
 *   - no affiliate URL is available
 *   - the verdict block can't be found (e.g. story-format posts)
 *   - a strip was already injected (idempotent — safe to call on rebuild)
 */
export function injectPriceStrip(content: string, opts: PriceStripOptions): string {
  if (!opts.affiliateUrl) return content
  // Idempotency: avoid double-stacking on a rebuild.
  if (content.includes('class="gr-price-strip"')) return content

  // Locate the close of the LATER of (a) the scorecard block, if present,
  // and (b) the verdict box. The opening of each lives on
  // `<div class="gr-scorecard">` / `<div class="gr-verdict-box">`. We need
  // the MATCHING closing </div> — those blocks contain nested divs.
  // Strategy: try scorecard first (newer block, comes after verdict in the
  // template), fall back to verdict-box if no scorecard was emitted (e.g.
  // story-format posts).
  const scorecardIdx = content.indexOf('class="gr-scorecard"')
  const verdictIdx = content.indexOf('class="gr-verdict-box"')
  const openIdx = scorecardIdx !== -1 ? scorecardIdx : verdictIdx
  if (openIdx === -1) return content
  // Back up to the `<div` that owns this class attribute.
  const divStart = content.lastIndexOf('<div', openIdx)
  if (divStart === -1) return content

  let depth = 0
  let i = divStart
  let closeEnd = -1
  // Tag walk — depth-tracking on <div> open/close pairs only.
  while (i < content.length) {
    const nextOpen = content.indexOf('<div', i)
    const nextClose = content.indexOf('</div>', i)
    if (nextClose === -1) break
    if (nextOpen !== -1 && nextOpen < nextClose) {
      depth += 1
      i = nextOpen + 4
    } else {
      depth -= 1
      i = nextClose + 6
      if (depth === 0) {
        closeEnd = i
        break
      }
    }
  }
  if (closeEnd === -1) return content

  // Insertion point: just after the verdict box's closing </div>. If the
  // verdict was wrapped in a Gutenberg <!-- wp:html --> comment pair, jump
  // past the closing comment so we don't split the block.
  const afterClose = content.slice(closeEnd)
  const wpHtmlEnd = afterClose.match(/^\s*<!--\s*\/wp:html\s*-->/)
  const insertAt = closeEnd + (wpHtmlEnd ? wpHtmlEnd[0].length : 0)

  const strip = '\n\n' + renderPriceStrip(opts) + '\n\n'
  return content.slice(0, insertAt) + strip + content.slice(insertAt)
}

/** Minimal HTML escape for attribute + text contexts in the strip. */
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}
