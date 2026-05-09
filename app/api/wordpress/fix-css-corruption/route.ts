import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'

export const maxDuration = 300

export async function POST() {
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

    // CSS corruption markers to strip
    const cssMarkers = [
      '/* gomin-thumbnail-ratio */',
      '/* affiliate-os-',
      '.post-thumbnail img,.wp-post-image',
      '.post-thumbnail img,\n.wp-post-image',
    ]

    // Fetch all posts with raw content
    const affected: { id: number; title: string }[] = []
    let fixed = 0
    let page = 1

    while (true) {
      const res = await fetch(
        `${base}/wp-json/wp/v2/posts?per_page=100&page=${page}&status=publish&context=edit&_fields=id,title,content`,
        { headers },
      )
      if (!res.ok) break
      const posts = await res.json() as { id: number; title: { rendered: string }; content: { raw: string } }[]
      if (!posts.length) break

      for (const post of posts) {
        const raw = post.content?.raw || ''
        const hasCorruption = cssMarkers.some(m => raw.includes(m))
        if (!hasCorruption) continue

        affected.push({ id: post.id, title: post.title?.rendered ?? '' })

        // Strip everything from the first CSS marker to the end of that CSS block
        // The CSS was appended at the end of content, so find the earliest marker and cut from there
        let cleaned = raw
        for (const marker of cssMarkers) {
          const idx = cleaned.indexOf(marker)
          if (idx !== -1) {
            cleaned = cleaned.slice(0, idx).trimEnd()
          }
        }

        // Update the post
        const updateRes = await fetch(`${base}/wp-json/wp/v2/posts/${post.id}`, {
          method: 'POST',
          headers: { ...headers, 'Content-Type': 'application/json' },
          body: JSON.stringify({ content: cleaned }),
        })
        if (updateRes.ok) fixed++
      }

      const totalPages = parseInt(res.headers.get('X-WP-TotalPages') || '1', 10)
      if (page >= totalPages) break
      page++
    }

    return NextResponse.json({
      success: true,
      scanned: page * 100,
      affected: affected.length,
      fixed,
      posts: affected.map(p => p.title),
    })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
