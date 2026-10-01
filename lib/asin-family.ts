// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// A PRODUCT'S FAMILY: ITS PARENT LISTING AND ITS OTHER COLOURS AND SIZES.
//
// On Amazon the black and the white version of a fan are different products
// (different ASINs) under one parent listing. A creator who sold the black one
// and a campaign that names the white one are about the same product, and an
// exact match cannot see it.
//
// Families come from Keepa (1 token a product) and are kept in asin_families
// for everyone (migration 391), looked up again after 30 days. A product Keepa
// was not asked about, or could not answer for, has no family here, which is
// "not known", not "has no variations": it still matches exactly.

import { fetchKeepaFamilies, keepaConfigured } from '@/services/keepa'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Sb = any

export type Family = { asin: string; parentAsin: string | null; siblings: string[]; attrs: string | null }

const STALE_MS = 30 * 86_400_000

/** Every ASIN that counts as the same product as `f`, itself included. Pure. */
export function familyMembers(f: Family | undefined, asin: string): Set<string> {
  const s = new Set<string>([asin])
  if (!f) return s
  if (f.parentAsin) s.add(f.parentAsin)
  for (const x of f.siblings) s.add(x)
  return s
}

export type FamilyReport = {
  /** Products asked about. */
  asked: number
  /** Of those, how many have a family on file now (fresh or just looked up). */
  known: number
  /** Looked up on Keepa this time. */
  lookedUp: number
  /** Why some could not be looked up or saved, when that happened. */
  error: string | null
}

/** Families for these ASINs: stored ones, then Keepa for the rest (at most
 *  `maxLookups`, most important first as given). */
export async function familiesFor(sb: Sb, asins: string[], opts: { maxLookups?: number } = {}): Promise<{ families: Map<string, Family>; lookedUp: number; report: FamilyReport }> {
  const want = [...new Set(asins.map((a) => String(a || '').toUpperCase()).filter((a) => /^[A-Z0-9]{10}$/.test(a)))]
  const families = new Map<string, Family>()
  const fresh = new Set<string>()
  for (let i = 0; i < want.length; i += 300) {
    const { data, error } = await sb.from('asin_families').select('asin,parent_asin,siblings,attrs,checked_at').in('asin', want.slice(i, i + 300))
    // Migration 391 not run: exact matching only, and said.
    if (error) return { families, lookedUp: 0, report: { asked: want.length, known: 0, lookedUp: 0, error: /asin_families/.test(String(error.message)) ? 'Migration 391 has not been run.' : String(error.message) } }
    for (const r of (data ?? []) as Array<{ asin: string; parent_asin: string | null; siblings: string[] | null; attrs: string | null; checked_at: string }>) {
      families.set(r.asin, { asin: r.asin, parentAsin: r.parent_asin, siblings: r.siblings ?? [], attrs: r.attrs })
      if (Date.now() - Date.parse(r.checked_at) < STALE_MS) fresh.add(r.asin)
    }
  }
  const missing = want.filter((a) => !fresh.has(a)).slice(0, opts.maxLookups ?? 300)
  const report: FamilyReport = { asked: want.length, known: fresh.size, lookedUp: 0, error: null }
  if (!missing.length) return { families, lookedUp: 0, report }
  if (!keepaConfigured()) return { families, lookedUp: 0, report: { ...report, error: 'no Keepa key on the server' } }
  const { families: got, error: keepaError } = await fetchKeepaFamilies(missing)
  report.error = keepaError
  // A product Keepa answered for with no parent and no variations is a single
  // listing: stored too, so it is not asked about again for 30 days.
  const rows = [...got.values()].map((f) => ({ asin: f.asin, parent_asin: f.parentAsin, siblings: f.siblings, attrs: f.attrs, checked_at: new Date().toISOString() }))
  for (const f of got.values()) families.set(f.asin, f)
  for (let i = 0; i < rows.length; i += 200) {
    const { error: upErr } = await sb.from('asin_families').upsert(rows.slice(i, i + 200), { onConflict: 'asin' })
    if (upErr) { report.error = report.error ?? `could not save families (${upErr.message})`; break }
  }
  report.lookedUp = got.size
  report.known = fresh.size + got.size
  return { families, lookedUp: got.size, report }
}
