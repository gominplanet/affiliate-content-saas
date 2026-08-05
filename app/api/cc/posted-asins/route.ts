// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential. No copying, redistribution, reverse-engineering, or reuse. See LICENSE.
//
// GET /api/cc/posted-asins  → { ok, posted: { [ASIN]: url } }
//
// The UNIVERSAL "have I made content for this product" map, keyed by ASIN.
// Gathers published posts from every flow so the CC Campaigns "Posted" badge +
// "View post" light up no matter how the post was made:
//   A. campaigns table — CC-flow + deal posts (status='published').
//   B. blog_posts (published) → their videos' ASINs (migration 204) — the
//      regular Blog Post Generator path, which doesn't create a campaigns row.
//
// Session-authed. Cheap: reads are capped and the ASIN columns are indexed.

import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const supabase = await createServerClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })

    const posted: Record<string, string> = {}
    const setUrl = (asin: unknown, url: unknown) => {
      const a = String(asin || '').toUpperCase()
      if (!/^[A-Z0-9]{10}$/.test(a)) return
      if (!posted[a]) posted[a] = (typeof url === 'string' && url) ? url : ''
    }

    // A — campaigns table (CC + deal posts).
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: camps } = await (supabase as any)
      .from('campaigns')
      .select('asin,status,wordpress_url')
      .eq('user_id', user.id)
      .eq('status', 'published')
      .limit(4000)
    for (const c of camps ?? []) if (c?.wordpress_url) setUrl(c.asin, c.wordpress_url)

    // B — published blog posts → their videos' ASINs (Blog Post Generator).
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: bp } = await (supabase as any)
      .from('blog_posts')
      .select('video_id,wordpress_url')
      .eq('user_id', user.id)
      .eq('status', 'published')
      .not('video_id', 'is', null)
      .limit(4000)
    const urlByVideo = new Map<string, string>()
    for (const p of bp ?? []) {
      if (p?.video_id && !urlByVideo.has(p.video_id)) urlByVideo.set(p.video_id, typeof p.wordpress_url === 'string' ? p.wordpress_url : '')
    }
    const videoIds = [...urlByVideo.keys()].slice(0, 2000)
    if (videoIds.length) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: vids } = await (supabase as any)
        .from('youtube_videos')
        .select('id,asin')
        .eq('user_id', user.id)
        .in('id', videoIds)
        .not('asin', 'is', null)
      for (const v of vids ?? []) setUrl(v?.asin, urlByVideo.get(v?.id))
    }

    return NextResponse.json({ ok: true, posted })
  } catch (err) {
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 })
  }
}
