// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// Drives /api/amazon-videos/read-products from a page: slice after slice
// until the library is read, Amazon blocks, or the creator stops watching.
// The same work carries on in the cron with the page closed, so stopping
// loses nothing.

import { requestVdpReads } from '@/lib/extension-frame'

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

export type ScoutReadOutcome =
  | { kind: 'done'; p: ProductReadProgress }
  | { kind: 'stopped'; p: ProductReadProgress }
  | { kind: 'no-scout' | 'old-scout' | 'blocked' | 'stuck'; p: ProductReadProgress; error?: string }

/**
 * The same read, done by SCOUT from the creator's own connection with fetch
 * (no tab), when Amazon robot-checks MVP's server. Forty videos a batch: MVP
 * hands out the unread ids, SCOUT reads their pages, MVP saves the answers.
 */
export async function readVideoProductsViaScout(onProgress: (p: ProductReadProgress) => void, shouldStop: () => boolean, start?: ProductReadProgress): Promise<ScoutReadOutcome> {
  const p: ProductReadProgress = start ? { ...start } : { total: null, remaining: null, withProducts: 0, links: 0, noProducts: 0, notFound: 0, errors: 0 }
  let barren = 0
  for (let batch = 0; batch < 400; batch++) {
    if (shouldStop()) return { kind: 'stopped', p }
    const pend = await fetch('/api/amazon-videos/pending?limit=40', { cache: 'no-store', signal: AbortSignal.timeout(30_000) }).then((r) => r.json()).catch(() => null) as { acis?: string[]; remaining?: number } | null
    if (!pend) return { kind: 'stuck', p, error: 'MVP could not be reached' }
    p.remaining = typeof pend.remaining === 'number' ? pend.remaining : p.remaining
    const ids = (pend.acis ?? []).map((a) => (/^amzn1\.vse\.video\.([0-9a-f]{32})$/i.exec(a)?.[1] ?? '').toLowerCase()).filter(Boolean)
    if (!ids.length) { onProgress({ ...p }); return { kind: 'done', p } }
    const r = await requestVdpReads(ids)
    if (!r.ok) {
      if (r.error === 'not-installed') return { kind: 'no-scout', p }
      if (r.error === 'needs-update' || r.error === 'unknown-message') return { kind: 'old-scout', p }
      return { kind: 'stuck', p, error: r.error }
    }
    const saved = await fetch('/api/amazon-videos/vdp-results', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ results: r.results }), signal: AbortSignal.timeout(30_000),
    }).then((x) => x.json()).catch(() => null) as { saved?: number; withProducts?: number; links?: number; noProducts?: number; notFound?: number; errors?: number; remaining?: number; error?: string } | null
    if (!saved) return { kind: 'stuck', p, error: 'MVP could not save what SCOUT read' }
    if (saved.error) return { kind: 'stuck', p, error: saved.error }
    p.withProducts += saved.withProducts ?? 0; p.links += saved.links ?? 0; p.noProducts += saved.noProducts ?? 0; p.notFound += saved.notFound ?? 0; p.errors += saved.errors ?? 0
    p.remaining = typeof saved.remaining === 'number' ? saved.remaining : p.remaining
    onProgress({ ...p })
    if (r.stoppedBlocked) return { kind: 'blocked', p }
    // The same unread ids come back until they are read, so a batch that
    // saved nothing, twice, will not save anything the third time.
    if (!saved.saved) { if (++barren >= 2) return { kind: 'stuck', p, error: 'Amazon answered none of the last two batches' } } else barren = 0
    if (p.remaining === 0) return { kind: 'done', p }
  }
  return { kind: 'stuck', p, error: 'stopped after 400 batches' }
}
