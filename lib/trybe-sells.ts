// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// WHAT A TRYBE BRAND SELLS (Seb, 2026-10-16: "is there a way for MVP to know
// if the brands on trybe have physical products or a selling a service or
// SAAS, or app? that would be valuable to be able to search with those
// filters").
//
// TRYBE does not say. MVP reads it from what it already keeps for every
// brand, with nothing fetched for this: TRYBE's own categories, description
// and tagline, whether TRYBE says the brand sends samples, the brand's home
// page text, and its store's product list (Shopify shares one only for a
// store that sells products). Each kind gathers points from what was seen,
// and the reasons are kept so the page can say why.
//
// A brand with too little to go on is NOT KNOWN, never guessed: "Privacy
// policy" on every website is not insurance, a "Gift card" in a store is not
// a product, and "Tech & Gadgets" is a shelf of devices, not software. Under
// the Sells filter a brand that is not known is left out and counted, the
// same rule as a pay minimum (Seb, 2026-10-16: "if there is no data it
// should simply not show up there"). Pure.

export type Sells = 'physical' | 'app' | 'software' | 'service'
export const SELLS: Sells[] = ['physical', 'app', 'software', 'service']

export const SELLS_WORDS: Record<Sells, { label: string; chip: string; says: string }> = {
  physical: { label: 'Physical products', chip: 'Sells products', says: 'Things that ship: you get a sample and film it.' },
  app: { label: 'Apps', chip: 'An app', says: 'A phone app: you film yourself using it.' },
  software: { label: 'Software', chip: 'Software', says: 'Software or an online tool (SaaS): you film your screen and the result.' },
  service: { label: 'Services', chip: 'A service', says: 'A service such as insurance, finance, health care or coaching: nothing ships.' },
}

export interface SellsRead {
  /** What it mainly sells, or null when MVP has too little to tell. */
  kind: Sells | null
  /** Every kind with enough behind it (a product brand with its own app is both). */
  kinds: Sells[]
  /** Why, in words, strongest first. */
  why: string[]
}

export interface SellsInput {
  name?: string | null
  categories?: string[] | null
  /** TRYBE's description of the brand. */
  about?: string | null
  /** The brand's home page and product names, as MVP keeps them (site_text). */
  siteText?: string | null
  /** Its store's product names (site_products). */
  products?: string[] | null
  /** TRYBE says it sends samples (DirStats.samples). */
  samples?: boolean | null
  /** TRYBE's own row (tagline, program description). */
  raw?: unknown
}

/** Enough points to say a brand sells this. */
const ENOUGH = 3

// Store items that are not things that ship.
const NOT_GOODS = /\b(gift ?cards?|e-?gift|memberships?|subscriptions? plan|donations?|digital download|e-?books?|courses?|consultations?|tips?|insurance|warranty|protection plan|shipping protection|route package protection)\b/i

const PHYSICAL_CATS = /\b(beauty|skin ?care|hair|makeup|cosmetic|fragrance|supplement|vitamin|nutrition|kitchen|cookware|home|decor|furniture|bedding|sleep|pets?|dog|cat|baby|kids|toys?|fashion|clothing|apparel|men'?s|women'?s|shoes|footwear|jewel|accessor|food|snack|beverage|drink|coffee|tea|cleaning|personal care|outdoor|camping|garden|craft|hobby|gadget|electronic|device|auto|car care|sports|fitness equipment|bags?|eyewear|watch)/i
const SERVICE_CATS = /\b(insurance|finance|financial|banking|loans?|credit|legal|real estate|services?|telehealth|healthcare provider|education|courses?|coaching|travel booking)\b/i
const APP_CATS = /\b(apps?|mobile apps?)\b/i
const SOFTWARE_CATS = /\b(software|saas|b2b software)\b/i

function textOf(raw: unknown): string {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return ''
  const o = raw as Record<string, unknown>
  const brand = o.brand && typeof o.brand === 'object' ? o.brand as Record<string, unknown> : {}
  const program = o.program && typeof o.program === 'object' ? o.program as Record<string, unknown> : {}
  return [o.tagline, brand.description, program.description, program.name].filter((v) => typeof v === 'string').join(' ')
}

export function sellsOf(b: SellsInput): SellsRead {
  const pts: Record<Sells, number> = { physical: 0, app: 0, software: 0, service: 0 }
  const why: Record<Sells, Array<{ w: number; text: string }>> = { physical: [], app: [], software: [], service: [] }
  const add = (k: Sells, w: number, text: string) => { pts[k] += w; why[k].push({ w, text }) }

  const cats = (b.categories || []).map((c) => String(c || '')).filter(Boolean)
  // What the brand says about itself, and what its website says.
  const own = `${b.name || ''} ${b.about || ''} ${textOf(b.raw)}`.toLowerCase()
  const site = String(b.siteText || '').toLowerCase()
  const all = `${own} ${site}`

  // ── Physical: a store with goods, samples, a shelf of things ──
  const goods = (b.products || []).filter((p) => p && !NOT_GOODS.test(p))
  if (goods.length >= 3) add('physical', 3, `its store lists ${goods.length} products`)
  else if (goods.length > 0) add('physical', 2, `its store lists ${goods.length === 1 ? 'a product' : `${goods.length} products`}`)
  if (b.samples === true) add('physical', 3, 'TRYBE says it sends samples')
  const shelf = cats.find((c) => PHYSICAL_CATS.test(c))
  if (shelf) add('physical', 2, `TRYBE lists it under ${shelf}`)
  const shipWords = (all.match(/\b(add to cart|free shipping|ships (?:free|in|within|to|worldwide)|shop now|in stock|sold out|bundle and save|refills?|\d+ ?(?:oz|ml|fl oz|ct|count|pack))\b/g) || [])
  if (shipWords.length) add('physical', Math.min(2, new Set(shipWords).size), `its website says "${shipWords[0]}"`)

  // ── App: the stores apps live in ──
  const appWords = all.match(/\b(app store|google play|download (?:the|our) app|get the app|ios (?:and|&) android|iphone app|android app)\b/g) || []
  const appHit = appWords[0] || ''
  if (appHit) add('app', 3, `it points to the ${/google play/.test(appHit) ? 'Google Play' : /app store/.test(appHit) ? 'App Store' : 'app'}`)
  const appCat = cats.find((c) => APP_CATS.test(c))
  if (appCat) add('app', 3, `TRYBE lists it under ${appCat}`)
  if (/\bapp\b/.test(String(b.name || '').toLowerCase())) add('app', 1, 'its name says app')

  // ── Software: trials, seats, dashboards ──
  const swStrong = all.match(/\b(saas|software|chrome extension|browser extension)\b/g) || []
  if (swStrong.length) add('software', 2, `it calls itself ${swStrong[0] === 'saas' ? 'SaaS' : swStrong[0]}`)
  const swWords = new Set(all.match(/\b(free trial|start (?:your )?(?:free )?trial|sign up free|per (?:user|seat)|dashboard|integrations?|book a demo|request a demo|no credit card required|workflow|ai[- ](?:powered|tool|assistant))\b/g) || [])
  if (swWords.size) add('software', Math.min(3, swWords.size), `its website says "${Array.from(swWords)[0]}"`)
  const swCat = cats.find((c) => SOFTWARE_CATS.test(c))
  if (swCat) add('software', 3, `TRYBE lists it under ${swCat}`)

  // ── Service: things done for you, nothing ships ──
  const svWords = new Set(all.match(/\b(insurance|get a quote|free quote|mortgage|loans?|credit cards?|banking|investing|tax (?:filing|prep)|attorneys?|lawyers?|legal services?|book (?:a|your) (?:consultation|appointment|session|call)|coaching|therapy|therapists?|telehealth|clinic|dentist|med ?spa|financial advisors?|real estate|cleaning service|moving company)\b/g) || [])
  if (svWords.size) add('service', Math.min(4, svWords.size * 2), `it talks about ${Array.from(svWords)[0]}`)
  const svCat = cats.find((c) => SERVICE_CATS.test(c))
  if (svCat) add('service', 2, `TRYBE lists it under ${svCat}`)

  // A brand that ships samples is selling things, whatever its site adds.
  if (b.samples === true) { pts.software = Math.min(pts.software, ENOUGH - 1); pts.service = Math.min(pts.service, ENOUGH - 1) }

  const kinds = SELLS.filter((k) => pts[k] >= ENOUGH).sort((a, z) => pts[z] - pts[a])
  const kind = kinds[0] ?? null
  return { kind, kinds, why: kind ? why[kind].sort((a, z) => z.w - a.w).map((x) => x.text) : [] }
}

/** The filter: a kind asked for, read safely. */
export function readSells(v: unknown): Sells | null {
  return typeof v === 'string' && (SELLS as string[]).includes(v) ? v as Sells : null
}
