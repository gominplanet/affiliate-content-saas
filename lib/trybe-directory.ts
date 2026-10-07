// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// TRYBE BRAND DIRECTORY (Labs): every brand on TRYBE, in MVP, searched by
// MVP's own rules.
//
// Seb, 2026-10-06: TRYBE's own search "does not work very well ... we should
// have scout get all of the brands and website in one go ... and from there
// make our own filtration". TRYBE's Discover page loads its list from
// jointrybe.com/backend/api/discovery/brands, 75 a page (5,917 brands on
// 79 pages that day). SCOUT asks for every page from the creator's own
// signed-in TRYBE tab and hands the entries to MVP as TRYBE wrote them.
//
// THE READING IS HERE, ON THE SERVER, NOT IN SCOUT. TRYBE's field names were
// seen only in part (`brandId`, a `pagination` block), so each field is found
// by the names it is likely to have, and the raw entry is kept. A field read
// wrongly is fixed here, with no new SCOUT and no Chrome Web Store review.
//
// The directory is shared: TRYBE's list is the same for every member, so it
// is collected once and each brand's website is read once. Each member's own
// requests, drafts and statuses stay in trybe_brands, theirs alone.

export interface DirectoryBrand {
  brandId: string
  name: string
  website: string | null
  categories: string[]
  about: string | null
  payText: string | null
  trybeScore: number | null
  totalCreators: number | null
  rating: number | null
  raw: Record<string, unknown>
}

type Obj = Record<string, unknown>
const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v)

/** The value under the first of these keys that has one, in the list's own
 *  order: on the entry itself first, then inside the brand's own nested object
 *  (`brand`, `brandProfile`, `company`...). Never inside other nested objects,
 *  where a logo's `url` would pass for the brand's website. */
const BRANDISH = /brand|profile|company|business|store|shop/i
function pick(o: Obj, keys: string[]): unknown {
  const find = (x: Obj, key: string) => {
    const k = Object.keys(x).find(n => n.toLowerCase() === key.toLowerCase())
    const v = k ? x[k] : undefined
    return v == null || v === '' ? undefined : v
  }
  for (const key of keys) { const v = find(o, key); if (v !== undefined) return v }
  const nested = Object.entries(o).filter(([k, v]) => BRANDISH.test(k) && isObj(v)).map(([, v]) => v as Obj)
  for (const key of keys) for (const n of nested) { const v = find(n, key); if (v !== undefined) return v }
  return undefined
}

const text = (v: unknown, max: number): string | null => {
  const s = typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : typeof v === 'number' ? String(v) : ''
  return s ? s.slice(0, max) : null
}
const num = (v: unknown): number | null => {
  const n = typeof v === 'number' ? v : parseFloat(String(v ?? '').replace(/[^0-9.]/g, ''))
  return Number.isFinite(n) ? n : null
}
function site(v: unknown): string | null {
  const s = text(v, 400)
  if (!s || /\s/.test(s)) return null
  try {
    const u = new URL(/^https?:\/\//i.test(s) ? s : `https://${s}`)
    if (!/^https?:$/.test(u.protocol) || !u.hostname.includes('.') || /(^|\.)jointrybe\.com$/i.test(u.hostname)) return null
    return u.toString()
  } catch { return null }
}
function names(v: unknown, max = 10): string[] {
  const list = Array.isArray(v) ? v : typeof v === 'string' ? v.split(/\s*[,•|]\s*/) : []
  const out: string[] = []
  for (const c of list) {
    const n = typeof c === 'string' ? c : isObj(c) ? text(c.category ?? c.name ?? c.label ?? c.title, 60) : null
    const t = n ? n.replace(/\s+/g, ' ').trim().slice(0, 60) : ''
    if (t && !out.includes(t)) out.push(t)
    if (out.length >= max) break
  }
  return out
}

/** One TRYBE entry, read. Null when it has no brand id or name. */
export function readDirectoryItem(raw: unknown): DirectoryBrand | null {
  if (!isObj(raw)) return null
  const brandObj = isObj(raw.brand) ? raw.brand : null
  const brandId = text(raw.brandId ?? raw.brand_id ?? brandObj?.id ?? raw.id, 80)
  if (!brandId || !/^[A-Za-z0-9-]{6,80}$/.test(brandId)) return null
  const name = text(pick(raw, ['brandName', 'brand_name', 'name', 'companyName', 'company_name', 'displayName', 'title']), 120)
  if (!name) return null
  const payRaw = pick(raw, ['payText', 'pay', 'payout', 'rate', 'pricePerVideo', 'price_per_video', 'compensation', 'budgetPerCreator', 'paymentPerVideo', 'amount'])
  const payNum = num(payRaw)
  return {
    brandId,
    name,
    website: site(pick(raw, ['website', 'websiteUrl', 'website_url', 'websiteURL', 'websiteLink', 'site', 'siteUrl', 'storeUrl', 'store_url', 'shopUrl', 'domain'])),
    categories: names(pick(raw, ['categories', 'nicheCategories', 'niche_categories', 'niches', 'niche', 'category', 'industries', 'industry', 'tags'])),
    about: text(pick(raw, ['description', 'about', 'bio', 'summary', 'brandDescription', 'brand_description', 'tagline']), 2000),
    payText: typeof payRaw === 'string' ? text(payRaw, 120) : payNum != null ? `$${payNum}` : null,
    trybeScore: num(pick(raw, ['trybeScore', 'trybe_score', 'score'])),
    totalCreators: num(pick(raw, ['totalCreators', 'total_creators', 'creatorsCount', 'creatorCount', 'creators_count'])),
    rating: num(pick(raw, ['rating', 'averageRating', 'avgRating'])),
    raw: raw as Record<string, unknown>,
  }
}

/** A page's entries, one per brand (TRYBE may list a brand more than once,
 *  one entry per offer): the first entry wins, gaps filled from later ones. */
export function mergeDirectory(items: unknown[]): DirectoryBrand[] {
  const by = new Map<string, DirectoryBrand>()
  for (const it of items) {
    const b = readDirectoryItem(it)
    if (!b) continue
    const had = by.get(b.brandId)
    if (!had) { by.set(b.brandId, b); continue }
    by.set(b.brandId, {
      ...had,
      website: had.website || b.website,
      categories: had.categories.length ? had.categories : b.categories,
      about: had.about || b.about,
      payText: had.payText || b.payText,
      trybeScore: had.trybeScore ?? b.trybeScore,
      totalCreators: had.totalCreators ?? b.totalCreators,
      rating: had.rating ?? b.rating,
    })
  }
  return Array.from(by.values())
}

/** What MVP searches a brand by: everything TRYBE says about it, lowercased. */
export function directorySearchText(b: Pick<DirectoryBrand, 'name' | 'categories' | 'about'>): string {
  return [b.name, b.categories.join(' '), b.about || ''].join(' ').toLowerCase().replace(/\s+/g, ' ').trim().slice(0, 4000)
}

/** What MVP searches a brand's website by: its text and product names. */
export function siteSearchText(summary: string, products: string[]): string {
  return [summary, products.join(' ')].join(' ').toLowerCase().replace(/\s+/g, ' ').trim().slice(0, 5000)
}

/** How well a brand matches the creator's niche, from MVP's own copy.
 *  Keywords count most in the name or a product, then on the website, then in
 *  TRYBE's description. A category counts when TRYBE files the brand under it
 *  or its words appear. 0 means no match at all. Pure. */
export function nicheScore(
  b: { name: string; categories: string[]; about: string | null; siteText: string | null; products: string[] },
  categories: string[],
  keywords: string[],
): number {
  const low = (s: string) => s.toLowerCase()
  const name = low(b.name)
  const about = low(b.about || '')
  const siteTxt = low(b.siteText || '')
  const products = b.products.map(low).join(' | ')
  const cats = b.categories.map(low)
  let score = 0
  for (const k of keywords.map(low).filter(Boolean)) {
    if (name.includes(k)) score += 30
    if (products.includes(k)) score += 25
    if (siteTxt.includes(k)) score += 15
    if (about.includes(k)) score += 12
    if (cats.some(c => c.includes(k))) score += 10
  }
  for (const c of categories.map(low).filter(Boolean)) {
    if (cats.some(x => x === c || x.includes(c) || c.includes(x))) score += 20
    else {
      // "Beauty & Personal Care" counts when its main words show up.
      const words = c.split(/[^a-z0-9]+/).filter(w => w.length > 3)
      if (words.some(w => about.includes(w) || siteTxt.includes(w) || products.includes(w))) score += 6
    }
  }
  return score
}

/** TRYBE's own category list, read: names only, in its order. */
export function readCategories(raw: unknown): string[] {
  const list = Array.isArray(raw) ? raw : isObj(raw) && Array.isArray(raw.data) ? raw.data : []
  return names(list, 40)
}
