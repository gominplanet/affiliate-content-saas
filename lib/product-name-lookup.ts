// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// THE PRODUCT'S NAME FROM ITS ASIN, from what MVP already holds or is allowed
// to ask (2026-11-11, Jarett's Drop titles). Every YouTube title is written
// about a product, and a writer that cannot find the product's name has
// nothing to write about: that is how THIS TEST and BIG MISTAKE? reached
// YouTube. Asked in order, first answer wins:
//
//   1. the creator's own Amazon video products (Amazon's product title, read
//      from their own Creator account by SCOUT)
//   2. the storefront and EPC product lists (Amazon's titles, read the same way)
//   3. the shared Keepa cache, then Keepa itself (MVP's paid Keepa key)
//   4. Amazon's own Creators API (MVP's operator credentials)
//
// No Amazon page is fetched here. Each step has its own time limit and any
// failure moves on to the next. Server only.

import { deriveProductName } from '@/lib/product-name'
import { fetchKeepaBasicsCached } from '@/lib/keepa-cache'
import { keepaConfigured } from '@/services/keepa'
import { creatorsApiConfigured, getItemsByAsin } from '@/services/amazon-creators'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any

export interface FoundProductName {
  /** Amazon's full product title, as found. */
  title: string
  brand: string
  /** brand + short name ("Ninja Creami Deluxe 11 in 1"), what titles carry. */
  canonical: string
  source: 'amazon-videos' | 'storefront' | 'epc' | 'keepa-cache' | 'keepa' | 'creators-api'
}

const within = <T,>(p: Promise<T>, ms: number, fallback: T): Promise<T> =>
  Promise.race([p.catch(() => fallback), new Promise<T>((r) => setTimeout(() => r(fallback), ms))])

const usable = (t: unknown): string => {
  const s = String(t ?? '').replace(/\s+/g, ' ').trim()
  return s.length >= 6 && !/^[A-Z0-9]{10}$/i.test(s) ? s : ''
}

/** The product's name, or null when nothing MVP may ask knows it. Never throws. */
export async function productNameFor(db: Db, asin: string | null | undefined): Promise<FoundProductName | null> {
  const a = String(asin || '').trim().toUpperCase()
  if (!/^[A-Z0-9]{10}$/.test(a)) return null
  const done = (title: string, source: FoundProductName['source']): FoundProductName => {
    const n = deriveProductName(title)
    return { title, brand: n.brand, canonical: n.canonical || title, source }
  }
  const fromTable = async (table: string): Promise<string> => {
    const { data } = await db.from(table).select('title').eq('asin', a).not('title', 'is', null).limit(3)
    for (const r of (data || []) as Array<{ title: unknown }>) { const t = usable(r.title); if (t) return t }
    return ''
  }
  for (const [table, source] of [['amazon_video_products', 'amazon-videos'], ['storefront_catalog', 'storefront'], ['epc_products', 'epc'], ['keepa_product_cache', 'keepa-cache']] as const) {
    const t = await within(fromTable(table), 4000, '')
    if (t) return done(t, source)
  }
  if (keepaConfigured()) {
    const got = await within(fetchKeepaBasicsCached(db, [a]), 12_000, new Map())
    const t = usable(got.get(a)?.title)
    if (t) return done(t, 'keepa')
  }
  if (creatorsApiConfigured()) {
    const got = await within(getItemsByAsin([a]), 12_000, new Map())
    const t = usable(got.get(a)?.title)
    if (t) return done(t, 'creators-api')
  }
  return null
}
