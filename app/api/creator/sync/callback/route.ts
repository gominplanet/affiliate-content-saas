// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// POST /api/creator/sync/callback — the Apify ad-hoc webhook target. Fires when an
// Amazon storefront run finishes; we authenticate via the ?secret we set at start,
// read the run's dataset, upsert the products into storefront_catalog, mark the
// job done, and best-effort kick brand enrichment (Keepa) over the new ASINs.
// Public (no session) but secret-gated, and only ever writes the job's OWN user.
import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { readApifyDataset, mapAmazonItem } from '@/lib/creator-sync'
import { keepaConfigured, fetchKeepaBrandInfo } from '@/services/keepa'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  const url = new URL(request.url)
  const jobId = url.searchParams.get('job') || ''
  const secret = url.searchParams.get('secret') || ''
  const expected = (process.env.APIFY_WEBHOOK_SECRET || process.env.APIFY_TOKEN || '').trim()
  if (!jobId || !expected || secret !== expected) {
    return NextResponse.json({ ok: false }, { status: 401 })
  }

  const admin = createAdminClient()
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: job } = await (admin as any)
      .from('creator_sync_jobs').select('id,user_id,external_dataset_id,status').eq('id', jobId).maybeSingle()
    if (!job) return NextResponse.json({ ok: false }, { status: 404 })
    if (job.status === 'succeeded') return NextResponse.json({ ok: true, already: true }) // idempotent

    const body = await request.json().catch(() => ({})) as { resource?: { status?: string; defaultDatasetId?: string }; eventType?: string }
    const runStatus = body?.resource?.status || ''
    if (runStatus && runStatus !== 'SUCCEEDED') {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (admin as any).from('creator_sync_jobs').update({ status: 'failed', error: `run ${runStatus}`, finished_at: new Date().toISOString() }).eq('id', jobId)
      return NextResponse.json({ ok: true, failed: true })
    }

    const datasetId = body?.resource?.defaultDatasetId || job.external_dataset_id
    const items = datasetId ? await readApifyDataset(datasetId) : []
    const products = items.map(mapAmazonItem).filter((p): p is NonNullable<typeof p> => p !== null)
    // Dedupe by ASIN.
    const byAsin = new Map<string, typeof products[number]>()
    for (const p of products) if (!byAsin.has(p.asin)) byAsin.set(p.asin, p)
    const rows = [...byAsin.values()].map((p) => ({
      user_id: job.user_id, asin: p.asin,
      title: p.title, image_url: p.image, list_title: p.listTitle,
      synced_at: new Date().toISOString(),
    }))

    if (rows.length) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (admin as any).from('storefront_catalog').upsert(rows, { onConflict: 'user_id,asin' })
      // Best-effort brand enrichment for the newly-seen ASINs (bounded).
      if (keepaConfigured()) {
        try {
          const info = await fetchKeepaBrandInfo(rows.slice(0, 300).map((r) => r.asin))
          const now = new Date().toISOString()
          for (const r of rows.slice(0, 300)) {
            const hit = info.get(r.asin)
            if (!hit) continue
            const patch: Record<string, unknown> = { brand_synced_at: now }
            if (hit.brand) patch.brand = hit.brand
            if (hit.title && (!r.title || r.title.toUpperCase() === r.asin)) patch.title = hit.title
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            await (admin as any).from('storefront_catalog').update(patch).eq('user_id', job.user_id).eq('asin', r.asin)
          }
        } catch { /* enrichment is best-effort */ }
      }
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (admin as any).from('creator_sync_jobs')
      .update({ status: 'succeeded', item_count: rows.length, result: { products: rows.length, rawItems: items.length }, finished_at: new Date().toISOString() })
      .eq('id', jobId)
    return NextResponse.json({ ok: true, products: rows.length })
  } catch (e) {
    console.warn('[creator/sync/callback]', e instanceof Error ? e.message : String(e))
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (admin as any).from('creator_sync_jobs').update({ status: 'failed', error: 'callback-error', finished_at: new Date().toISOString() }).eq('id', jobId).then(() => undefined, () => undefined)
    return NextResponse.json({ ok: false }, { status: 500 })
  }
}
