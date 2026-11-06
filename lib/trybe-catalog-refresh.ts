// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// EVERY BRAND'S PRODUCTS ON TRYBE, KEPT FRESH (Seb, 2026-11-06: "even if it's
// once a day ... gather all the information we need from Tribe ... to be able
// to have it accessed really quickly by users throughout the day until the
// next update the next morning").
//
// TRYBE's public product list of a brand says which products take sample
// requests and what they are. MVP's server reads it (no one's TRYBE sign-in),
// keeps it a week in trybe_directory_meta as `samples:<brand id>`, and every
// member's search, My top 100 and brand page read MVP's copy. Two callers:
// the Daily refresh's "Products on TRYBE" step (a call at a time from the
// team's page) and the overnight job (app/api/cron/trybe-products), which
// runs whether or not anyone's computer is on.
//
// Gentle on TRYBE: a few at a time, a bounded batch a call; when TRYBE asks to
// slow down (429) or refuses (403) every reader stops at once and it is said.
// A brand that did not answer stays to read next time, never a "no".

import { catalogSamples, CATALOG_KEEP_DAYS, type CatalogSamples } from '@/lib/trybe-top100'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any

/** Read brands' product lists on TRYBE until `until`. Never throws. */
export async function readSampleCatalogs(ids: string[], until: number, o: { workers?: number; stats?: { refused: number; failed: number } } = {}): Promise<Map<string, CatalogSamples>> {
  const out = new Map<string, CatalogSamples>()
  let next = 0
  let halt = false
  const worker = async () => {
    while (!halt && next < ids.length && Date.now() < until - 1500) {
      const id = ids[next++]
      try {
        const res = await fetch(`https://jointrybe.com/backend/api/public/brand/${encodeURIComponent(id)}/products`, { signal: AbortSignal.timeout(Math.min(8000, Math.max(1500, until - Date.now()))), headers: { accept: 'application/json', 'user-agent': 'Mozilla/5.0 (MVP Affiliate)' } })
        if (res.ok) out.set(id, catalogSamples(await res.json()))
        else if (res.status === 404) out.set(id, { open: 0, total: 0 })
        else if (res.status === 429 || res.status === 403) { halt = true; if (o.stats) o.stats.refused++ }
        else if (o.stats) o.stats.failed++
      } catch { if (o.stats) o.stats.failed++ }
    }
  }
  await Promise.all(Array.from({ length: o.workers ?? 8 }, worker))
  return out
}

export interface CatalogRefreshResult {
  ok: true
  /** Brands on TRYBE's list (MVP's copy). */
  listed: number
  /** Of those, read within CATALOG_KEEP_DAYS before this call. */
  fresh: number
  read: number
  /** Still to read after this call. */
  left: number
  open: number
  refuse: number
  none: number
  /** TRYBE asked to slow down or refused: stopped. */
  refused: boolean
  failed: number
}

/** One pass: the listed brands whose product list is missing or older than a
 *  week, oldest-unknown first, up to `chunk` of them, read and kept. */
export async function refreshCatalogs(admin: Db, o: { chunk: number; budgetMs: number; workers: number; now?: string }): Promise<CatalogRefreshResult | { ok: false; error: string }> {
  const now = o.now ?? new Date().toISOString()
  const listed: string[] = []
  for (let from = 0; from < 50_000; from += 1000) {
    const { data, error } = await admin.from('trybe_directory').select('brand_id').is('left_at', null).order('brand_id').range(from, from + 999)
    if (error) return { ok: false, error: `MVP could not read its copy of TRYBE's brand list: ${error.message}` }
    listed.push(...((data || []) as Array<{ brand_id: string }>).map((r) => String(r.brand_id)))
    if (!data || data.length < 1000) break
  }
  const since = new Date(Date.now() - CATALOG_KEEP_DAYS * 86_400_000).toISOString()
  const fresh = new Set<string>()
  for (let from = 0; from < 50_000; from += 1000) {
    const { data, error } = await admin.from('trybe_directory_meta').select('key').like('key', 'samples:%').gte('updated_at', since).order('key').range(from, from + 999)
    if (error) return { ok: false, error: `MVP could not read which product lists it has: ${error.message}` }
    for (const r of (data || []) as Array<{ key: string }>) fresh.add(r.key.slice('samples:'.length))
    if (!data || data.length < 1000) break
  }
  const todo = listed.filter((id) => !fresh.has(id) && /^[A-Za-z0-9-]{6,80}$/.test(id))
  const stats = { refused: 0, failed: 0 }
  const got = await readSampleCatalogs(todo.slice(0, o.chunk), Date.now() + o.budgetMs, { workers: o.workers, stats })
  const kept = Array.from(got.entries()).map(([id, v]) => ({ key: `samples:${id}`, value: v, updated_at: now }))
  for (let i = 0; i < kept.length; i += 200) {
    const { error } = await admin.from('trybe_directory_meta').upsert(kept.slice(i, i + 200))
    if (error) return { ok: false, error: `Read ${got.size} product lists, but MVP could not keep them: ${error.message}` }
  }
  const vals = Array.from(got.values())
  return {
    ok: true, listed: listed.length, fresh: fresh.size, read: got.size, left: Math.max(0, todo.length - got.size),
    open: vals.filter((v) => v.open > 0).length, refuse: vals.filter((v) => v.total > 0 && v.open === 0).length, none: vals.filter((v) => v.total === 0).length,
    refused: stats.refused > 0, failed: stats.failed,
  }
}
