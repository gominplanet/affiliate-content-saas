/**
 * GET /api/newsletter/blog-posts — pickable posts for the compose UI
 *
 * Returns the creator's published blog posts (newest first) — id, title,
 * excerpt, url, thumbnail. The compose page renders these as checkboxes
 * with a thumbnail + a one-line preview so the creator can scan + pick
 * the issue's lineup in seconds.
 *
 * Capped at the most recent 80 — past that, scroll fatigue beats picking
 * accuracy. If a creator ever has more than 80 candidates per issue,
 * we'll add search/filter; for v1, recency is the right ordering.
 */
import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'

export async function GET() {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any)
    .from('blog_posts')
    .select('id,title,excerpt,wordpress_url,thumbnail_url,published_at')
    .eq('user_id', user.id)
    .eq('status', 'published')
    .order('published_at', { ascending: false, nullsFirst: false })
    .limit(80)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({
    posts: ((data as Array<{ id: string; title: string | null; excerpt: string | null; wordpress_url: string | null; thumbnail_url: string | null; published_at: string | null }>) || [])
      .filter(p => !!p.wordpress_url)
      .map(p => ({
        id: p.id,
        title: p.title || 'Untitled',
        excerpt: (p.excerpt || '').slice(0, 220),
        url: p.wordpress_url,
        thumbnail: p.thumbnail_url,
        publishedAt: p.published_at,
      })),
  })
}
