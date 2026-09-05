// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// GET /api/amazon-videos/pending — the videos whose products have not been read.
//
// The video library says what a creator made and how it performed. It does not
// say which product each video was selling, and without that the library cannot
// be joined to earnings, to the storefront, or to anything published off Amazon.
// Reading the products is what turns a description of the content into an
// explanation of the income.
//
// That read is one call per video, thousands of them, so it runs as a resumable
// job and this is where it gets its next slice of work. Rows are handed out
// oldest first by ACI so a restart covers new ground rather than re-reading the
// same head of the list.
import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 })

  const url = new URL(request.url)
  const limit = Math.min(500, Math.max(1, Number(url.searchParams.get('limit')) || 200))
  // Two orderings, for two different jobs.
  //
  // The crawl wants a stable order so a restart covers new ground, and ACI does
  // that. But discovery has to find one of these videos ON THE PAGE in order to
  // click it, and the page lists newest first, so handing it the oldest videos
  // in the library means it almost never finds one and falls back to clicking
  // blind. `order=recent` is for that.
  const recent = url.searchParams.get('order') === 'recent'

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let q = (supabase as any)
    .from('amazon_videos')
    .select('aci')
    .eq('user_id', user.id)
  if (!recent) q = q.is('products_synced_at', null)
  const { data, error } = await q
    .order(recent ? 'published_at' : 'aci', { ascending: !recent, nullsFirst: false })
    .limit(limit)
  if (error) return NextResponse.json({ error: error.message, acis: [] }, { status: 200 })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { count } = await (supabase as any)
    .from('amazon_videos')
    .select('aci', { count: 'exact', head: true })
    .eq('user_id', user.id)
    .is('products_synced_at', null)

  return NextResponse.json({
    ok: true,
    acis: ((data ?? []) as { aci: string }[]).map(r => r.aci),
    remaining: count ?? 0,
  })
}
