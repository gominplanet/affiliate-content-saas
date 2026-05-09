import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'

export const maxDuration = 60

export async function GET() {
  try {
    const supabase = await createServerClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { data: integration } = await supabase
      .from('integrations')
      .select('wordpress_url,wordpress_username,wordpress_app_password')
      .eq('user_id', user.id)
      .single()

    const wp = integration as Record<string, string> | null
    if (!wp?.wordpress_url || !wp?.wordpress_username || !wp?.wordpress_app_password) {
      return NextResponse.json({ error: 'WordPress not connected' }, { status: 400 })
    }

    const base = wp.wordpress_url.replace(/\/$/, '')
    const auth = Buffer.from(`${wp.wordpress_username}:${wp.wordpress_app_password.replace(/\s+/g, '')}`).toString('base64')
    const headers = { Authorization: `Basic ${auth}` }

    type RawPost = {
      id: number
      title: { rendered: string }
      link: string
      date: string
      _embedded?: { 'wp:featuredmedia'?: { source_url: string }[] }
    }

    // Fetch all published posts (paginated 100 at a time)
    const allPosts: { id: number; title: string; link: string; date: string; thumbnail: string | null }[] = []
    let page = 1
    while (true) {
      const res = await fetch(
        `${base}/wp-json/wp/v2/posts?per_page=100&page=${page}&status=publish&orderby=date&order=desc&_embed=wp:featuredmedia`,
        { headers },
      )
      if (!res.ok) break
      const batch = await res.json() as RawPost[]
      if (!batch.length) break
      for (const p of batch) {
        allPosts.push({
          id: p.id,
          title: p.title?.rendered ?? '',
          link: p.link,
          date: p.date,
          thumbnail: p._embedded?.['wp:featuredmedia']?.[0]?.source_url ?? null,
        })
      }
      const totalPages = parseInt(res.headers.get('X-WP-TotalPages') || '1', 10)
      if (page >= totalPages) break
      page++
    }

    return NextResponse.json({ posts: allPosts })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
