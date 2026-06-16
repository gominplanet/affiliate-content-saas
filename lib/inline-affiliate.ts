/**
 * Weave a few inline affiliate hyperlinks into an article body so the link
 * appears in-prose (on the product name), not only in the "Get it now" CTA
 * buttons. Campaign / PartnerBoost / video-review posts otherwise carry the
 * affiliate link solely in the CTA card — these in-text links lift CTR + SEO.
 *
 * Deterministic + safe:
 *   - links at most one mention per text segment → naturally spaced across
 *     paragraphs (no two links jammed together),
 *   - only whole-word matches (won't link inside another word),
 *   - never links inside an existing <a> (no nested anchors), a <style>/<script>
 *     block (would corrupt CSS/JS — e.g. a "Box…" product vs `box-sizing`),
 *     the CTA card text (class="gr-cta-*"), or a heading,
 *   - no-ops when the model already placed ≥2 inline affiliate links itself,
 *   - no-ops cleanly when the product name can't be found in the prose.
 */

/** The longest leading slice of the product name (4→1 words) that actually
 *  appears in the visible text — a natural, specific anchor phrase. */
function pickAnchorPhrase(html: string, productName: string): string | null {
  const words = productName.replace(/["“”,|]/g, ' ').split(/\s+/).filter(Boolean)
  const textOnly = html.replace(/<[^>]+>/g, ' ').toLowerCase()
  for (const n of [4, 3, 2, 1]) {
    if (words.length < n) continue
    const phrase = words.slice(0, n).join(' ')
    if (phrase.length >= 3 && textOnly.includes(phrase.toLowerCase())) return phrase
  }
  return null
}

const isAlnum = (ch: string) => /[a-z0-9]/i.test(ch)

/** Index of the first WHOLE-WORD occurrence of `needleLc` in `hayLc`, else -1.
 *  Whole-word = the chars immediately around it aren't alphanumeric, so "box"
 *  matches "box" / "box-sizing" boundaries but never the middle of "boxing". */
function indexOfWord(hayLc: string, needleLc: string): number {
  let from = 0
  for (;;) {
    const at = hayLc.indexOf(needleLc, from)
    if (at === -1) return -1
    const before = at > 0 ? hayLc[at - 1] : ' '
    const after = at + needleLc.length < hayLc.length ? hayLc[at + needleLc.length] : ' '
    if (!isAlnum(before) && !isAlnum(after)) return at
    from = at + needleLc.length
  }
}

export function injectInlineAffiliateLinks(
  html: string,
  productName: string,
  url: string,
  opts: { max?: number } = {},
): string {
  const max = opts.max ?? 3
  if (!html || !productName || !url) return html

  // Already linked in-prose by the writer? Count affiliate anchors that aren't
  // the big CTA button — if it did the job, leave it alone.
  const escUrl = url.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const existingRe = new RegExp(`<a\\b[^>]*href="${escUrl}"[^>]*>`, 'gi')
  let existing = 0
  let mm: RegExpExecArray | null
  while ((mm = existingRe.exec(html))) { if (!/gr-cta-btn/i.test(mm[0])) existing++ }
  if (existing >= 2) return html

  const phrase = pickAnchorPhrase(html, productName)
  if (!phrase) return html
  const phraseLc = phrase.toLowerCase()

  // Split into alternating tag / text tokens; only linkify text tokens outside
  // <a>…</a>, outside <style>/<script>, outside CTA-card elements, and outside
  // headings.
  const tokens = html.split(/(<[^>]+>)/)
  let depthA = 0       // inside an anchor (no nested links)
  let depthSkip = 0    // inside <style>/<script> (don't corrupt CSS/JS)
  let added = existing
  for (let i = 0; i < tokens.length && added < max; i++) {
    const tok = tokens[i]
    if (!tok) continue
    if (tok[0] === '<') {
      if (/^<a\b/i.test(tok)) depthA++
      else if (/^<\/a/i.test(tok)) depthA = Math.max(0, depthA - 1)
      else if (/^<(style|script)\b/i.test(tok)) depthSkip++
      else if (/^<\/(style|script)/i.test(tok)) depthSkip = Math.max(0, depthSkip - 1)
      continue
    }
    if (depthA > 0 || depthSkip > 0) continue
    const prevTag = tokens[i - 1] || ''
    if (/class="gr-cta-/i.test(prevTag) || /^<h[1-6]\b/i.test(prevTag)) continue
    const idx = indexOfWord(tok.toLowerCase(), phraseLc)
    if (idx === -1) continue
    const actual = tok.slice(idx, idx + phrase.length)
    tokens[i] =
      tok.slice(0, idx) +
      `<a href="${url}" target="_blank" rel="noopener sponsored nofollow">${actual}</a>` +
      tok.slice(idx + phrase.length)
    added++
  }
  return tokens.join('')
}
