// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// Reads which products each of a creator's Amazon videos sells, from the
// videos' public pages (lib/amazon-vdp), on MVP's server: no SCOUT, no tabs,
// no page left open. Fills amazon_video_products, which Brand recap, Earnings
// and the storefront reports already read.
//
// Resumable by design: a video is marked read (products_synced_at) once its
// page answered, whatever it said, so each run covers new ground. A robot
// check or a network failure leaves the video unread for the next run, and a
// run that meets robot checks stops at once rather than pressing on.

import { readVdp, vdpIdFromAci } from '@/lib/amazon-vdp'

export interface ProductReadRun {
  read: number          // pages that answered
  withProducts: number  // of those, videos with at least one product
  links: number         // video-to-product rows written
  noProducts: number    // page names no product
  notFound: number      // Amazon has no page for the video
  blocked: number       // robot checks met
  errors: number        // network or HTTP failures, left for the next run
  remaining: number | null
  stoppedFor: 'done' | 'time' | 'blocked' | null
  error?: string
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Sb = any

export async function readVideoProducts(sb: Sb, userId: string, opts: { budgetMs: number; concurrency?: number; batch?: number }): Promise<ProductReadRun> {
  const out: ProductReadRun = { read: 0, withProducts: 0, links: 0, noProducts: 0, notFound: 0, blocked: 0, errors: 0, remaining: null, stoppedFor: null }
  const until = Date.now() + opts.budgetMs
  const concurrency = Math.max(1, Math.min(6, opts.concurrency ?? 4))

  const { data, error } = await sb.from('amazon_videos').select('aci')
    .eq('user_id', userId).is('products_synced_at', null)
    .order('published_at', { ascending: false, nullsFirst: false }).limit(opts.batch ?? 400)
  if (error) { out.error = error.message; return out }
  const queue = ((data ?? []) as Array<{ aci: string }>).map((r) => r.aci)

  const doneAcis: string[] = []
  const rows: Array<{ user_id: string; aci: string; asin: string; title: string | null }> = []
  const counts = new Map<string, number>()
  let blockedRun = 0
  let stop: ProductReadRun['stoppedFor'] = null

  const flush = async () => {
    if (rows.length) {
      const batch = rows.splice(0, rows.length)
      const { error: e } = await sb.from('amazon_video_products').upsert(batch, { onConflict: 'user_id,aci,asin', ignoreDuplicates: true })
      if (e) throw new Error(`could not save products: ${e.message}`)
      out.links += batch.length
    }
    if (doneAcis.length) {
      const acis = doneAcis.splice(0, doneAcis.length)
      const at = new Date().toISOString()
      // Marked read together, and the product count set from what the page
      // named, grouped so it is a handful of writes rather than one per video.
      const byCount = new Map<number, string[]>()
      for (const a of acis) { const n = counts.get(a) ?? 0; byCount.set(n, [...(byCount.get(n) ?? []), a]) }
      for (const [n, group] of byCount) {
        const { error: e } = await sb.from('amazon_videos').update({ products_synced_at: at, product_count: n }).eq('user_id', userId).in('aci', group)
        if (e) throw new Error(`could not mark videos read: ${e.message}`)
      }
    }
  }

  const worker = async () => {
    while (queue.length && !stop) {
      if (Date.now() > until) { stop = 'time'; break }
      const aci = queue.shift() as string
      const id = vdpIdFromAci(aci)
      if (!id) { out.notFound++; counts.set(aci, 0); doneAcis.push(aci); continue }
      const r = await readVdp(id)
      if (r.state === 'blocked') {
        out.blocked++
        if (++blockedRun >= 3) stop = 'blocked'
        continue
      }
      blockedRun = 0
      if (r.state === 'error') { out.errors++; continue }
      out.read++
      if (r.state === 'ok') {
        out.withProducts++
        counts.set(aci, r.asins.length)
        for (const asin of r.asins) rows.push({ user_id: userId, aci, asin, title: null })
      } else {
        if (r.state === 'not-found') out.notFound++; else out.noProducts++
        counts.set(aci, 0)
      }
      doneAcis.push(aci)
      if (doneAcis.length >= 50) await flush()
    }
  }

  try {
    await Promise.all(Array.from({ length: concurrency }, worker))
    await flush()
  } catch (e) {
    out.error = e instanceof Error ? e.message : String(e)
  }
  const { count } = await sb.from('amazon_videos').select('aci', { count: 'exact', head: true })
    .eq('user_id', userId).is('products_synced_at', null)
  out.remaining = typeof count === 'number' ? count : null
  out.stoppedFor = stop ?? (out.remaining === 0 ? 'done' : queue.length ? 'time' : null)
  return out
}
