/**
 * GET /api/v1/blog-posts/[id]
 *
 * Fetch a single blog post by id. Returns the full row including the HTML
 * content body — heavier than the list endpoint so it's a separate fetch.
 * 404 if the id doesn't belong to the caller (no cross-account access).
 */

import { NextRequest, NextResponse } from 'next/server'
import { authenticateApiKey, apiAuthErrorResponse } from '@/lib/api-keys'
import { createAdminClient } from '@/lib/supabase/admin'

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authenticateApiKey(req)
  if (!auth.ok) {
    const { status, body } = apiAuthErrorResponse(auth.error)
    return NextResponse.json(body, { status })
  }

  const { id } = await params

  const admin = createAdminClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await admin
    .from('blog_posts')
    .select('id, title, slug, status, post_type, content, meta_description, wordpress_post_id, wordpress_url, hero_image_url, published_at, created_at, updated_at')
    .eq('id', id)
    .eq('user_id', auth.caller.userId)
    .maybeSingle()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!data) return NextResponse.json({ error: 'Not found', code: 'not_found' }, { status: 404 })

  return NextResponse.json({ data })
}
