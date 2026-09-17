// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// THE SAME URL, WRITTEN TWO WAYS, IS STILL THE SAME URL.
//
// A creator ran Fix Affiliate Links on a fresh post and reported that only half
// his links converted. His live post explains it exactly. Ten affiliate links,
// four distinct URL strings, and two of those four are the SAME link:
//
//   https://www.amazon.com/dp/B0FWBHDFWK?tag=x&#038;ascsubtag=y   x4
//   https://www.amazon.com/dp/B0FWBHDFWK?tag=x&ascsubtag=y        x1
//
// Identical destination. The ampersand is HTML-encoded in one and raw in the
// other, because WordPress encodes what it stores and the price-strip block is
// written by a different path than the CTA buttons.
//
// The fixer swaps one exact string: `content.split(oldUrl).join(newUrl)`. It
// matched the four and walked past the fifth, and the creator saw a button that
// still went to plain Amazon on a post the tool had just reported as fixed.
//
// Nothing about that is visible from the code. Both links look the same in a
// browser, both look the same in the editor, and the only place they differ is
// the byte the swap compares.
//
// So a swap works on every encoding of the URL it was given, and the rule is
// pure so it can be held to a real post's HTML.

/**
 * Every way this URL can appear in stored HTML.
 *
 * WordPress writes `&#038;`, some editors write `&amp;`, and anything built by
 * string concatenation writes a raw `&`. All three round-trip to the same link.
 *
 * Longest first, so replacing in order never leaves a half-decoded tail: swap
 * `&#038;` before `&`, or the bare-ampersand pass turns `&#038;` into
 * `&#038;` with the `&` already replaced and corrupts the URL.
 */
export function hrefVariants(url: string): string[] {
  const raw = url.replace(/&(?:amp|#0*38);/gi, '&')
  const variants = [
    raw.split('&').join('&#038;'),
    raw.split('&').join('&amp;'),
    raw,
  ]
  // Distinct, and longest first.
  return [...new Set(variants)].sort((a, b) => b.length - a.length)
}

/** Do these two URLs point at the same place, ignoring how the HTML spells it? */
export function sameUrl(a: string | null | undefined, b: string | null | undefined): boolean {
  const norm = (u: string) => u.replace(/&(?:amp|#0*38);/gi, '&').trim()
  if (!a || !b) return false
  return norm(a) === norm(b)
}

/**
 * Replace a URL everywhere it appears, in any encoding.
 *
 * Plain string splits rather than a RegExp, because a URL contains characters
 * that are meaningful in a pattern and building one from a URL is how a rewrite
 * matches the wrong thing or silently nothing at all.
 */
export function swapUrlEverywhere(html: string, from: string, to: string): string {
  if (!html || !from || sameUrl(from, to)) return html
  let out = html
  for (const variant of hrefVariants(from)) {
    if (!variant) continue
    out = out.split(variant).join(to)
  }
  return out
}

/**
 * How many times a URL appears, counting every encoding.
 *
 * A plain sum over the variants is correct, and it is worth saying why rather
 * than leaving a defensive line nobody can test. No variant is a substring of
 * another: `a&b`, `a&#038;b` and `a&amp;b` differ at the ampersand in both
 * directions, so the raw form cannot be found inside an encoded one. An earlier
 * version consumed each match to guard against double counting, and deleting
 * that guard changed no result, which is the same thing as it never having done
 * anything.
 *
 * A URL with no ampersand collapses to one variant, which the Set removes.
 */
export function countUrl(html: string, url: string): number {
  if (!html || !url) return 0
  return hrefVariants(url).reduce((n, variant) => n + (variant ? html.split(variant).length - 1 : 0), 0)
}
