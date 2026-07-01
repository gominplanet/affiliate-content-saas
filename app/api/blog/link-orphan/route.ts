// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// POST /api/blog/link-orphan  { postId, wpUrl, title }
//
// Backfill for "orphan" published posts — WordPress posts that have NO
// blog_posts row (e.g. a Levanta/PartnerBoost post generated while those routes
// omitted the NOT-NULL `slug`, so the row insert failed silently). Without a
// row, "Share with brand" and every social action 404 with "Post not found".
//
// This resolves-or-creates: if a blog_posts row already maps to this post (by WP
// id or permalink) it returns that id unchanged; otherwise it creates a minimal
// row from the WP post's title + permalink so the post becomes fully shareable.
// Idempotent + owner-scoped. Pure DB — makes no WordPress or YouTube calls.

import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { getAuthAndOwner } from '@/lib/agency-auth'
import { resolveBlogPostId } from '@/lib/resolve-post-id'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Prefer the real WordPress slug (last path segment of the permalink); fall
 *  back to a slugified title. Both keep `slug` (NOT NULL) satisfied. */
function slugFromUrl(u?: string | null): string {
  if (!u) return ''
  try {
    const path = new URL(u).pathname.replace(/\/+$/, '')
    return (path.split('/').filter(Boolean).pop() || '').toLowerCase()
  } catch {
    return ''
  }
}
function slugify(s: string): string {
  return (
    (s || '')
      .toLowerCase()
      .replace(/<[^>]+>/g, '')
      .replace(/&[a-z0-9#]+;/g, ' ')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 90) || 'post'
  )
}

export async function POST(request: Request) {
  const supabase = await createServerClient()
  const auth = await getAuthAndOwner(supabase)
  if (auth.error) return auth.error
  const { ownerId } = auth

  try {
    const { postId, wpUrl, title } = (await request.json()) as {
      postId?: string
      wpUrl?: string | null
      title?: string | null
    }

    // Already resolvable → nothing to do (idempotent).
    const existing = await resolveBlogPostId(supabase, ownerId, postId, wpUrl)
    if (existing && UUID_RE.test(existing)) {
      return NextResponse.json({ id: existing, created: false })
    }

    // Create a minimal row so social + brand-recap can resolve this post.
    const wpId = postId && /^\d+$/.test(postId) ? Number(postId) : null
    const slug = slugFromUrl(wpUrl) || slugify(title || '')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase as any)
      .from('blog_posts')
      .insert({
        user_id: ownerId,
        title: (title || 'Untitled').slice(0, 300),
        slug,
        status: 'published',
        post_type: 'review',
        wordpress_post_id: wpId,
        wordpress_url: wpUrl || null,
        published_at: new Date().toISOString(),
      })
      .select('id')
      .single()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    return NextResponse.json({ id: data.id as string, created: true })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}
