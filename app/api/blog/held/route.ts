// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// GET /api/blog/held — posts the quality gate kept as WordPress drafts, with
// the reasons, newest first. A held post is one auto-pilot wrote with no
// first-hand source or with too much that still read as machine-written
// (app/api/blog/generate). Publish anyway is /api/blog/publish-now, which
// clears the hold.
import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'

export const runtime = 'nodejs'

export async function GET() {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any).from('blog_posts')
    .select('id,title,wordpress_url,wordpress_post_id,wordpress_site_id,created_at,aio')
    .eq('user_id', user.id).not('aio->held', 'is', null)
    .order('created_at', { ascending: false }).limit(50)
  if (error) return NextResponse.json({ held: [], error: error.message })
  return NextResponse.json({
    held: (data ?? []).map((r: { id: string; title: string | null; wordpress_url: string | null; wordpress_post_id: number | null; created_at: string; aio: { held?: { at?: string; reasons?: string[] } } | null }) => ({
      id: r.id, title: r.title, wordpressUrl: r.wordpress_url, wordpressPostId: r.wordpress_post_id,
      at: r.aio?.held?.at ?? r.created_at, reasons: r.aio?.held?.reasons ?? [],
    })),
  })
}
