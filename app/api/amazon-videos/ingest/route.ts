// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// POST /api/amazon-videos/ingest — the creator's Amazon video library, read by
// SCOUT from the call Manage content makes for its own table.
//
// Two kinds of row arrive here:
//   videos   — one per published video, with Amazon's engagement figures.
//   products — which ASINs a given video features, from the per-video call.
//
// Both upsert on their natural key, so a re-sync corrects rather than
// duplicates. Nulls are preserved: Amazon not reporting a metric and a metric
// being zero are different claims, and only one of them is safe to display.
import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

interface VideoIn {
  aci?: string
  description?: string | null
  state?: string | null
  program?: string | null
  marketplaceId?: string | null
  durationSec?: number | null
  mediaUrl?: string | null
  views?: number | null
  hearts?: number | null
  avgPctViewed?: number | null
  avgViewSec?: number | null
  productCount?: number | null
  publishedAtMs?: number | null
  modifiedAtMs?: number | null
}
interface VideoProductIn { aci?: string; asin?: string; title?: string | null }

const int = (v: unknown): number | null => {
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? Math.round(n) : null
}
const dec = (v: unknown): number | null => {
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : null
}
/** Amazon sends epoch milliseconds. Anything else is dropped rather than coerced
 *  into a date that would silently be wrong by decades. */
const ts = (v: unknown): string | null => {
  const n = typeof v === 'number' ? v : Number(v)
  if (!Number.isFinite(n) || n <= 0) return null
  const d = new Date(n)
  return isNaN(d.getTime()) ? null : d.toISOString()
}
const str = (v: unknown, max = 500): string | null => {
  const s = typeof v === 'string' ? v.trim() : ''
  return s ? s.slice(0, max) : null
}

export async function POST(request: Request) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 })

  const body = await request.json().catch(() => null) as
    { videos?: VideoIn[]; products?: VideoProductIn[]; aciDone?: string[] } | null
  if (!body) return NextResponse.json({ error: 'Expected a JSON body.' }, { status: 400 })

  const admin = createAdminClient()
  let savedVideos = 0
  let savedProducts = 0
  const skipped: string[] = []

  if (Array.isArray(body.videos) && body.videos.length) {
    const rows = body.videos.map(v => {
      const aci = str(v.aci, 200)
      if (!aci) { skipped.push('video without an ACI'); return null }
      return {
        user_id: user.id,
        aci,
        description: str(v.description, 500),
        state: str(v.state, 60),
        program: str(v.program, 60),
        marketplace_id: str(v.marketplaceId, 40),
        duration_sec: dec(v.durationSec),
        media_url: str(v.mediaUrl, 1000),
        views: int(v.views),
        hearts: int(v.hearts),
        avg_pct_viewed: dec(v.avgPctViewed),
        avg_view_sec: dec(v.avgViewSec),
        product_count: int(v.productCount),
        published_at: ts(v.publishedAtMs),
        modified_at: ts(v.modifiedAtMs),
        synced_at: new Date().toISOString(),
      }
    }).filter((r): r is NonNullable<typeof r> => r !== null)

    if (rows.length) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await (admin as any)
        .from('amazon_videos')
        .upsert(rows, { onConflict: 'user_id,aci' })
      if (error) return NextResponse.json({ error: `Could not save videos: ${error.message}` }, { status: 500 })
      savedVideos = rows.length
    }
  }

  if (Array.isArray(body.products) && body.products.length) {
    const rows = body.products.map(p => {
      const aci = str(p.aci, 200)
      const asin = (p.asin || '').toString().trim().toUpperCase()
      if (!aci) { skipped.push('product row without an ACI'); return null }
      if (!/^[A-Z0-9]{10}$/.test(asin)) { skipped.push('product row without an ASIN'); return null }
      return { user_id: user.id, aci, asin, title: str(p.title, 300), synced_at: new Date().toISOString() }
    }).filter((r): r is NonNullable<typeof r> => r !== null)

    if (rows.length) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await (admin as any)
        .from('amazon_video_products')
        .upsert(rows, { onConflict: 'user_id,aci,asin' })
      if (error) return NextResponse.json({ error: `Could not save video products: ${error.message}` }, { status: 500 })
      savedProducts = rows.length
    }
  }

  // Videos whose product call finished, INCLUDING those that returned nothing.
  // Without this a video with no products would be retried on every run forever,
  // and the crawl would never finish.
  if (Array.isArray(body.aciDone) && body.aciDone.length) {
    const done = body.aciDone.map(a => str(a, 200)).filter((a): a is string => !!a).slice(0, 500)
    if (done.length) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (admin as any)
        .from('amazon_videos')
        .update({ products_synced_at: new Date().toISOString() })
        .eq('user_id', user.id)
        .in('aci', done)
    }
  }

  return NextResponse.json({
    ok: true,
    savedVideos,
    savedProducts,
    skipped: skipped.length,
    skippedReasons: Array.from(new Set(skipped)).slice(0, 5),
  })
}
