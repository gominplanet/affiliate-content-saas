// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// GET /api/amazon-videos — the creator's synced Amazon video library.
//
// `count` is the important field even when the list is not rendered: the crawl
// reads roughly a page a second and a library runs to thousands, so it cannot
// finish inside one run. It resumes from this count, which means each run picks
// up where the last one stopped instead of re-reading from the top.
import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 })

  const limit = Math.min(200, Math.max(0, Number(new URL(request.url).searchParams.get('limit')) || 0))

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { count, error } = await (supabase as any)
    .from('amazon_videos')
    .select('aci', { count: 'exact', head: true })
    .eq('user_id', user.id)
  if (error) return NextResponse.json({ error: error.message, count: 0, videos: [] }, { status: 200 })

  let videos: unknown[] = []
  if (limit > 0) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data } = await (supabase as any)
      .from('amazon_videos')
      .select('aci,description,state,views,hearts,avg_pct_viewed,avg_view_sec,duration_sec,product_count,published_at,media_url')
      .eq('user_id', user.id)
      .order('views', { ascending: false, nullsFirst: false })
      .limit(limit)
    videos = data ?? []
  }

  // How many still need their products fetched, which is the second half of this
  // and the thing that answers "which video sells this product".
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { count: pending } = await (supabase as any)
    .from('amazon_videos')
    .select('aci', { count: 'exact', head: true })
    .eq('user_id', user.id)
    .is('products_synced_at', null)

  return NextResponse.json({ ok: true, count: count ?? 0, pendingProducts: pending ?? 0, videos })
}
