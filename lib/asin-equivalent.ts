// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// THE SAME PRODUCT, UNDER ANOTHER COUNTRY'S ASIN.
//
// Amazon often lists one product under a different ASIN in each store: a router
// that is B091G65HH6 on amazon.com is B091GX3LWR on amazon.ca. Asking "is
// B091G65HH6 sold in Canada?" gets No, and the country was written off as "not
// sold here" for a product Canada sells. The barcode is what the listings
// share, so a product the same ASIN cannot find is looked for again by its
// UPC/EAN in that country's store.

/** Barcodes compared the way stores print them: a UPC-A (12 digits) is the
 *  same number as the EAN-13 with a leading zero, and a GTIN-14 adds another. */
export function normalizeCode(code: string): string {
  const d = String(code || '').replace(/\D/g, '')
  return d.replace(/^0+/, '')
}

/**
 * The local listing for a product, from the listings that share its barcode.
 * Only a listing with a title counts (Keepa returns empty shells), and when
 * several match, the one sharing the most codes wins, then the first. Null
 * when nothing shares a code: guessing by title would tag the wrong product.
 */
export function pickEquivalent(
  sourceCodes: string[],
  candidates: Array<{ asin: string; title: string | null; codes: string[] }>,
  sourceAsin: string,
): string | null {
  const want = new Set(sourceCodes.map(normalizeCode).filter((c) => c.length >= 8))
  if (!want.size) return null
  let best: { asin: string; shared: number } | null = null
  for (const c of candidates) {
    if (!c.title || c.asin.toUpperCase() === sourceAsin.toUpperCase()) continue
    const shared = new Set(c.codes.map(normalizeCode).filter((x) => want.has(x))).size
    if (shared === 0) continue
    if (!best || shared > best.shared) best = { asin: c.asin.toUpperCase(), shared }
  }
  return best?.asin ?? null
}

// ── WHEN THERE IS NO BARCODE TO GO ON: BRAND, AND MODEL OR NAME ─────────────
//
// Weaker than a barcode, so it is strict, and it says which it was. The brand
// must be the same. Then either the model number is the same, or (only on a
// store in the same language, since a French title is not an English one) the
// names agree closely AND every number in the name agrees: a 47 inch island is
// not the 36 inch one from the same brand. Anything less is no match, because
// tagging the wrong product is worse than not listing in that country.

export type NameMatch = { asin: string; how: 'model' | 'name' }

const STOP = new Set(['the', 'and', 'for', 'with', 'of', 'a', 'an', 'in', 'on', 'to', 'by', 'or', 'pack', 'new'])
const norm = (s: string | null | undefined) => String(s || '').toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
export const brandKey = (b: string | null | undefined) => norm(b).replace(/^visit the\s+|\s+store$/g, '').replace(/[^a-z0-9]/g, '')
const modelKey = (m: string | null | undefined) => norm(m).replace(/[^a-z0-9]/g, '')
/** A "model number" that is really an ASIN is no model number. Amazon's own
 *  devices carry their ASIN there (the eero router's model is B091G65HH6), and
 *  searching another store for it finds nothing, because that store's listing
 *  has its own ASIN. */
export const realModel = (m: string | null | undefined, asin?: string) => {
  const k = String(m || '').trim()
  if (!k) return null
  if (/^B0[A-Z0-9]{8}$/i.test(k) || (asin && k.toUpperCase() === asin.toUpperCase())) return null
  return k
}
/** The product's name without the selling points Amazon titles carry after a
 *  dash, a bar, a comma or a bracket: "Amazon eero Pro 6E mesh wifi router -
 *  Supports internet plans up to 2.5 Gbps, ..." is "Amazon eero Pro 6E mesh
 *  wifi router". Those tails differ by store and say nothing about identity. */
export const coreName = (t: string | null | undefined) => String(t || '').split(/\s[-–—|]\s|[,|(\[]/)[0].trim()
const joined = (t: string | null | undefined) => norm(t).replace(/([a-z0-9])-(?=[a-z0-9])/g, '$1')
const words = (t: string | null | undefined) => new Set(joined(t).split(/[^a-z0-9]+/).filter((w) => w.length >= 2 && !STOP.has(w)))
/** The words in a name that carry a digit, whole: "6E" is not "6", "47" is
 *  not "36". These are what tells one model from its sibling. */
const numbers = (t: string | null | undefined) => new Set(joined(t).split(/[^a-z0-9.]+/).map((w) => w.replace(/^\.+|\.+$/g, '')).filter((w) => /\d/.test(w)))
/** "1-pack", "3 pack", "pack of 2": a different count is a different listing. */
const packOf = (t: string | null | undefined) => {
  const m = norm(t).match(/(\d+)\s*-?\s*(?:pack|pk|count|ct)\b|pack of\s*(\d+)/)
  return m ? Number(m[1] || m[2]) : null
}

/** How alike two names are, 0 to 1: shared words over all words. */
export function nameSimilarity(a: string | null | undefined, b: string | null | undefined): number {
  const A = words(a), B = words(b)
  if (!A.size || !B.size) return 0
  let shared = 0
  for (const w of A) if (B.has(w)) shared++
  return shared / (A.size + B.size - shared)
}

export const NAME_MATCH_MIN = 0.6

export function pickByName(
  source: { asin: string; brand: string | null; title: string | null; model: string | null },
  candidates: Array<{ asin: string; brand: string | null; title: string | null; model: string | null }>,
  sameLanguage: boolean,
): NameMatch | null {
  const brand = brandKey(source.brand)
  if (!brand || !source.title) return null
  const model = modelKey(realModel(source.model, source.asin))
  const core = coreName(source.title)
  const nums = numbers(core)
  const pack = packOf(source.title) ?? 1
  let best: { asin: string; how: 'model' | 'name'; score: number } | null = null
  for (const c of candidates) {
    if (!c.title || c.asin.toUpperCase() === source.asin.toUpperCase()) continue
    if (brandKey(c.brand) !== brand) continue
    // A 3-pack is not the 1-pack, whatever else agrees.
    if ((packOf(c.title) ?? 1) !== pack) continue
    const cm = modelKey(realModel(c.model, c.asin))
    if (model.length >= 3 && cm === model) {
      const score = 2 + nameSimilarity(source.title, c.title)
      if (!best || score > best.score) best = { asin: c.asin.toUpperCase(), how: 'model', score }
      continue
    }
    // A different model number on both sides is a different product.
    if (model.length >= 3 && cm.length >= 3) continue
    if (!sameLanguage) continue
    const cc = coreName(c.title)
    const cn = numbers(cc)
    if ([...nums].some((n) => !cn.has(n)) || [...cn].some((n) => !nums.has(n))) continue
    const sim = nameSimilarity(core, cc)
    if (sim < NAME_MATCH_MIN) continue
    if (!best || sim > best.score) best = { asin: c.asin.toUpperCase(), how: 'name', score: sim }
  }
  return best ? { asin: best.asin, how: best.how } : null
}

/** What to search a store for: the brand with the model number when there is
 *  one, else the brand with the start of the name. */
export function nameSearchTerm(source: { brand: string | null; title: string | null; model: string | null }): string | null {
  // (realModel with no ASIN still drops anything shaped like one.)
  const brand = String(source.brand || '').trim()
  if (!brand) return null
  const model = String(realModel(source.model) || '')
  if (model.length >= 3) return `${brand} ${model}`
  const title = coreName(source.title).split(/\s+/).slice(0, 8).join(' ')
  return title ? (norm(title).includes(norm(brand)) ? title : `${brand} ${title}`) : null
}
