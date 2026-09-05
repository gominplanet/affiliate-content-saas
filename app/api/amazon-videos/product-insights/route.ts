// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// GET /api/amazon-videos/product-insights — where the video library meets the
// money.
//
// Fetching only. Every judgement lives in lib/video-product-insights.ts as a
// pure function, so it can be tested without a browser, an extension and a live
// Amazon session, which is the condition that let every previous wrong number
// on this page reach a real creator.
import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import {
  analyseVideoProducts,
  type VideoLite, type VideoProduct, type ProductEarning, type ShelfRow,
} from '@/lib/video-product-insights'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** PostgREST caps a select at 1,000 rows. A library of thousands truncated at
 *  that would make every count here wrong in the same quiet way the scanner kept
 *  failing, so everything is paged. */
async function readAll<T>(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any, table: string, columns: string, userId: string, orderBy: string, cap = 60000,
): Promise<T[]> {
  const rows: T[] = []
  for (let from = 0; from < cap; from += 1000) {
    const { data, error } = await supabase
      .from(table).select(columns).eq('user_id', userId)
      .order(orderBy, { ascending: true }).range(from, from + 999)
    if (error) break
    const page = (data ?? []) as T[]
    rows.push(...page)
    if (page.length < 1000) break
  }
  return rows
}

export async function GET() {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 })

  const videos = await readAll<VideoLite>(
    supabase, 'amazon_videos', 'aci,description,views,hearts,published_at,products_synced_at', user.id, 'aci')
  if (!videos.length) return NextResponse.json({ ok: true, coverage: { videos: 0 } })

  const links = await readAll<VideoProduct>(
    supabase, 'amazon_video_products', 'aci,asin,title', user.id, 'aci')
  const earnings = await readAll<ProductEarning>(
    supabase, 'amazon_earnings_products', 'asin,product_title,earnings_cents', user.id, 'asin')

  // The storefront is optional: a creator who has never synced it gets no claim
  // about what is on their shelf, rather than absence read as "not on it".
  let shelf: ShelfRow[] = []
  let shelfKnown = false
  try {
    shelf = await readAll<ShelfRow>(supabase, 'storefront_catalog', 'asin,title', user.id, 'asin')
    shelfKnown = shelf.length > 0
  } catch { /* no shelf, no claim */ }

  return NextResponse.json(analyseVideoProducts(videos, links, earnings, shelf, shelfKnown))
}
