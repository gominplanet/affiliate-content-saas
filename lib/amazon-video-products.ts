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
  // Gently. Four pages at once got MVP's server robot-checked after about a
  // hundred; two at a time with a pause between pages is under a request a
  // second, which is how a person browsing reads.
  const concurrency = Math.max(1, Math.min(3, opts.concurrency ?? 2))
  const pause = () => new Promise((r) => setTimeout(r, 500 + Math.floor(Math.random() * 700)))

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

  // One video: read its page and record what it said. False when the run
  // should stop.
  const one = async (aci: string): Promise<void> => {
    const id = vdpIdFromAci(aci)
    if (!id) { out.notFound++; counts.set(aci, 0); doneAcis.push(aci); return }
    const r = await readVdp(id)
    if (r.state === 'blocked') {
      out.blocked++
      if (++blockedRun >= 3) stop = 'blocked'
      return
    }
    blockedRun = 0
    if (r.state === 'error') { out.errors++; return }
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
  const worker = async () => {
    while (queue.length && !stop) {
      if (Date.now() > until) { stop = 'time'; break }
      await pause()
      if (!queue.length || stop) break
      await one(queue.shift() as string)
    }
  }

  try {
    // ONE PAGE FIRST, ALONE. While Amazon is robot-checking the server, that
    // one request is all a run costs, which is the back-off: no state to keep,
    // and the run after Amazon relents simply carries on.
    if (queue.length) {
      await one(queue.shift() as string)
      if (out.blocked) stop = 'blocked'
    }
    if (!stop) await Promise.all(Array.from({ length: concurrency }, worker))
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

/**
 * Save reads that SCOUT made from the creator's own connection (the fallback
 * when Amazon robot-checks MVP's server). Same rules as above: a video is
 * marked read only when its page answered; blocked and failed reads are left
 * for the next try. Only this creator's own unread videos are touched.
 */
export async function recordVideoReads(sb: Sb, userId: string, reads: Array<{ id: string; state: string; asins?: string[] }>):
  Promise<{ saved: number; withProducts: number; links: number; noProducts: number; notFound: number; blocked: number; errors: number; error?: string }> {
  const out = { saved: 0, withProducts: 0, links: 0, noProducts: 0, notFound: 0, blocked: 0, errors: 0 } as { saved: number; withProducts: number; links: number; noProducts: number; notFound: number; blocked: number; errors: number; error?: string }
  const clean = reads.filter((r) => r && /^[0-9a-f]{32}$/.test(String(r.id))).slice(0, 100)
  if (!clean.length) return out
  const acis = clean.map((r) => `amzn1.vse.video.${r.id}`)
  const { data: mine, error } = await sb.from('amazon_videos').select('aci').eq('user_id', userId).in('aci', acis)
  if (error) return { ...out, error: error.message }
  const own = new Set(((mine ?? []) as Array<{ aci: string }>).map((r) => r.aci))
  const rows: Array<{ user_id: string; aci: string; asin: string; title: null }> = []
  const byCount = new Map<number, string[]>()
  for (const r of clean) {
    const aci = `amzn1.vse.video.${r.id}`
    if (!own.has(aci)) continue
    if (r.state === 'blocked') { out.blocked++; continue }
    if (r.state !== 'ok' && r.state !== 'no-products' && r.state !== 'not-found') { out.errors++; continue }
    const asins = r.state === 'ok' ? (r.asins ?? []).map((a) => String(a).toUpperCase()).filter((a) => /^[A-Z0-9]{10}$/.test(a)) : []
    if (r.state === 'ok' && asins.length) { out.withProducts++; for (const asin of asins) rows.push({ user_id: userId, aci, asin, title: null }) }
    else if (r.state === 'not-found') out.notFound++
    else out.noProducts++
    byCount.set(asins.length, [...(byCount.get(asins.length) ?? []), aci])
    out.saved++
  }
  if (rows.length) {
    const { error: e } = await sb.from('amazon_video_products').upsert(rows, { onConflict: 'user_id,aci,asin', ignoreDuplicates: true })
    if (e) return { ...out, saved: 0, error: `could not save products: ${e.message}` }
    out.links = rows.length
  }
  const at = new Date().toISOString()
  for (const [n, group] of byCount) {
    const { error: e } = await sb.from('amazon_videos').update({ products_synced_at: at, product_count: n }).eq('user_id', userId).in('aci', group)
    if (e) return { ...out, error: `could not mark videos read: ${e.message}` }
  }
  return out
}
