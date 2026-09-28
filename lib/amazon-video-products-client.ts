// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// Drives /api/amazon-videos/read-products from a page: slice after slice
// until the library is read, Amazon blocks, or the creator stops watching.
// The same work carries on in the cron with the page closed, so stopping
// loses nothing.

export interface ProductReadProgress {
  total: number | null
  remaining: number | null
  withProducts: number
  links: number
  noProducts: number
  notFound: number
  errors: number
}

export type ProductReadOutcome =
  | { kind: 'done'; p: ProductReadProgress }
  | { kind: 'no-library'; p: ProductReadProgress }
  | { kind: 'blocked'; p: ProductReadProgress }
  | { kind: 'stuck'; p: ProductReadProgress; error: string }
  | { kind: 'stopped'; p: ProductReadProgress }

export async function readAllVideoProducts(onProgress: (p: ProductReadProgress) => void, shouldStop: () => boolean): Promise<ProductReadOutcome> {
  const p: ProductReadProgress = { total: null, remaining: null, withProducts: 0, links: 0, noProducts: 0, notFound: 0, errors: 0 }
  let idle = 0
  for (let slice = 0; slice < 200; slice++) {
    if (shouldStop()) return { kind: 'stopped', p }
    let j: Record<string, unknown>
    try {
      // The route reads for about 40s and may take up to its 60s limit.
      const r = await fetch('/api/amazon-videos/read-products', { method: 'POST', signal: AbortSignal.timeout(75_000) })
      j = await r.json().catch(() => ({ error: `HTTP ${r.status}` }))
      if (!r.ok && !('remaining' in j)) return { kind: 'stuck', p, error: String(j.error || `HTTP ${r.status}`) }
    } catch {
      if (++idle >= 3) return { kind: 'stuck', p, error: 'MVP could not be reached' }
      continue
    }
    const n = (k: string) => Number(j[k]) || 0
    p.total = typeof j.total === 'number' ? j.total : p.total
    p.remaining = typeof j.remaining === 'number' ? j.remaining : p.remaining
    p.withProducts += n('withProducts'); p.links += n('links'); p.noProducts += n('noProducts'); p.notFound += n('notFound'); p.errors += n('errors')
    onProgress({ ...p })
    if (p.total === 0) return { kind: 'no-library', p }
    if (j.stoppedFor === 'blocked') return { kind: 'blocked', p }
    if (p.remaining === 0) return { kind: 'done', p }
    if (j.error) return { kind: 'stuck', p, error: String(j.error) }
    // A slice that read nothing, twice running, is not going to read more.
    if (n('read') === 0) { if (++idle >= 2) return { kind: 'stuck', p, error: 'Amazon answered no pages in the last two tries' } } else idle = 0
  }
  return { kind: 'stuck', p, error: 'stopped after 200 slices' }
}
