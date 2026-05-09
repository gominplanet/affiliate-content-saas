import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'

export const maxDuration = 120

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

    type RawPost = { id: number; title: { rendered: string }; link: string; date: string; featured_media: number }
    type RawMedia = { id: number; source_url: string }

    // ── 1. Fetch all posts (lightweight — no embed) ───────────────────────────
    const rawPosts: RawPost[] = []
    let page = 1
    while (true) {
      const res = await fetch(
        `${base}/wp-json/wp/v2/posts?per_page=100&page=${page}&status=publish&orderby=date&order=desc&_fields=id,title,link,date,featured_media`,
        { headers },
      )
      if (!res.ok) {
        const body = await res.text()
        if (page === 1) return NextResponse.json({ error: `WordPress ${res.status}: ${body.slice(0, 200)}` }, { status: 502 })
        break
      }
      const batch = await res.json() as RawPost[]
      if (!batch.length) break
      rawPosts.push(...batch)
      const totalPages = parseInt(res.headers.get('X-WP-TotalPages') || '1', 10)
      if (page >= totalPages) break
      page++
    }

    // ── 2. Fetch thumbnails in one batch per 100 media IDs ────────────────────
    const mediaIds = [...new Set(rawPosts.map(p => p.featured_media).filter(Boolean))]
    const thumbMap: Record<number, string> = {}
    for (let i = 0; i < mediaIds.length; i += 100) {
      const chunk = mediaIds.slice(i, i + 100)
      try {
        const mRes = await fetch(
          `${base}/wp-json/wp/v2/media?include=${chunk.join(',')}&per_page=100&_fields=id,source_url`,
          { headers },
        )
        if (mRes.ok) {
          const media = await mRes.json() as RawMedia[]
          for (const m of media) thumbMap[m.id] = m.source_url
        }
      } catch { /* thumbnails are non-fatal */ }
    }

    // ── 3. Assemble final list ────────────────────────────────────────────────
    const posts = rawPosts.map(p => ({
      id: p.id,
      title: p.title?.rendered ?? '',
      link: p.link,
      date: p.date,
      thumbnail: thumbMap[p.featured_media] ?? null,
    }))

    return NextResponse.json({ posts })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[wordpress/posts]', msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
