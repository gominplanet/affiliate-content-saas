// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// Does a post's title name the product the post sells?
//
// Checked before the post is published, against the product's own Amazon
// listing (lib/product-name), not against the body: a title and a body can
// agree with each other and both be about the wrong thing. The model is told
// to put the product name in the title; this is the check that it did.

const STOP = new Set(['the', 'and', 'for', 'with', 'from', 'new', 'pro', 'max', 'plus', 'mini', 'set', 'kit', 'pack', 'review', 'best', 'inch', 'black', 'white', 'size'])

const tokens = (s: string | null | undefined) => new Set(
  String(s || '').toLowerCase().replace(/&amp;/g, '&').split(/[^a-z0-9]+/).filter((w) => w.length >= 3 && !STOP.has(w)),
)

/**
 * ok when the title carries the product's brand (its first word), or at least half of the
 * distinctive words of its short name. Unknown product: nothing to check
 * against, so ok with `checked: false`, which is not the same as a pass.
 */
export function titleNamesProduct(title: string, product: { brand?: string | null; canonical?: string | null } | null):
  { ok: boolean; checked: boolean; missing?: string } {
  if (!product || (!product.brand && !product.canonical)) return { ok: true, checked: false }
  const t = tokens(title)
  const brand = [...tokens(product.brand)]
  // The brand's first word is the brand ("Beatbot" of "Beatbot AquaSense").
  if (brand.length && t.has(brand[0])) return { ok: true, checked: true }
  const name = [...tokens(product.canonical)].filter((w) => !brand.includes(w))
  if (name.length && name.filter((w) => t.has(w)).length / name.length >= 0.5) return { ok: true, checked: true }
  return { ok: false, checked: true, missing: product.canonical || product.brand || '' }
}

/** The fallback when a corrected title still misses: the product's name and
 *  the one word every reader understands, within the title length. */
export function plainProductTitle(canonical: string): string {
  const base = canonical.trim().replace(/\s+/g, ' ')
  return (base.length > 56 ? base.slice(0, 56).replace(/\s+\S*$/, '') : base) + ' Review'
}
