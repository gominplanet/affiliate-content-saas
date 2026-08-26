// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// The creator's unified "brands I've worked with" set — merged from their Amazon
// storefront (products → brand) and their TikTok (tagged/sponsored/mentioned
// brands). Keyed by a normalized brand key so the two sources dedupe cleanly and
// an external name (TRYBE's "Discover Brands") can be matched against it. Used by
// the searchable list and the TRYBE cross-check endpoints.

import { deriveProductName } from '@/lib/product-name'
import { brandKey, brandDisplay } from '@/lib/brand-normalize'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any

export interface WorkedBrand {
  key: string
  brand: string                 // display name
  amazon: number                // # storefront products
  tiktok: number                // # TikTok signals
  confident: boolean            // a confirmed partner somewhere (tagged/sponsored)
  image: string | null
}

/**
 * Build the creator's worked-with brand map (key → WorkedBrand). Amazon brands
 * come from storefront_catalog (enriched `brand`, else derived from the title);
 * TikTok brands come from the latest succeeded TikTok sync's stored aggregation.
 * Best-effort: a source that errors just contributes nothing.
 */
export async function getWorkedWithBrands(supabase: Db, userId: string): Promise<Map<string, WorkedBrand>> {
  const map = new Map<string, WorkedBrand>()
  const bump = (rawName: string | null, opts: { amazon?: number; tiktok?: number; confident?: boolean; image?: string | null }) => {
    const key = brandKey(rawName)
    if (!key) return
    const display = brandDisplay(rawName) || rawName || key
    const cur = map.get(key) || { key, brand: display, amazon: 0, tiktok: 0, confident: false, image: null }
    cur.amazon += opts.amazon || 0
    cur.tiktok += opts.tiktok || 0
    cur.confident = cur.confident || !!opts.confident
    if (!cur.image && opts.image) cur.image = opts.image
    // Prefer the shorter, cleaner display name if a better one shows up.
    if (display && display.length < cur.brand.length && brandKey(display) === key) cur.brand = display
    map.set(key, cur)
  }

  // ── Amazon storefront ──────────────────────────────────────────────────────
  try {
    const { data: cat } = await supabase
      .from('storefront_catalog').select('title,image_url,brand').eq('user_id', userId).limit(5000)
    for (const r of (cat ?? []) as Array<{ title: string | null; image_url: string | null; brand: string | null }>) {
      const b = (r.brand && r.brand.trim()) || deriveProductName(r.title).brand
      if (b) bump(b, { amazon: 1, image: r.image_url })
    }
  } catch { /* no storefront data */ }

  // ── TikTok (latest succeeded sync) ─────────────────────────────────────────
  try {
    const { data: job } = await supabase
      .from('creator_sync_jobs').select('result')
      .eq('user_id', userId).eq('source', 'tiktok').eq('status', 'succeeded')
      .order('created_at', { ascending: false }).limit(1).maybeSingle()
    const brands = (job?.result?.brands ?? []) as Array<{ brand: string; total?: number; confident?: boolean }>
    for (const b of brands) bump(b.brand, { tiktok: b.total || 1, confident: !!b.confident })
  } catch { /* no tiktok data */ }

  return map
}

/** Sorted, optionally search-filtered list for the UI. */
export function brandList(map: Map<string, WorkedBrand>, q?: string | null): WorkedBrand[] {
  const needle = (q || '').trim().toLowerCase()
  let items = [...map.values()]
  if (needle) items = items.filter((b) => b.brand.toLowerCase().includes(needle) || b.key.includes(brandKey(needle)))
  return items.sort((a, b) =>
    Number(b.confident) - Number(a.confident) ||
    (b.amazon + b.tiktok) - (a.amazon + a.tiktok) ||
    a.brand.localeCompare(b.brand),
  )
}
