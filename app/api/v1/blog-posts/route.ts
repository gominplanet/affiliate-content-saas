/**
 * GET /api/v1/blog-posts
 *
 * List the authenticated user's blog posts. Cursor-paginated; defaults to
 * the 50 most-recent posts. Use ?limit=N (max 100) + ?cursor=<created_at>
 * to walk older pages.
 *
 *   ?status=published | draft | failed   filter by status
 *   ?limit=50                            max 100
 *   ?cursor=2026-05-01T00:00:00.000Z     created_at < cursor
 *
 * Response:
 *   {
 *     data: BlogPost[],
 *     nextCursor: string | null   // ISO created_at of the last item, or null
 *   }
 */

import { NextRequest, NextResponse } from 'next/server'
import { authenticateApiKey, apiAuthErrorResponse } from '@/lib/api-keys'
import { createAdminClient } from '@/lib/supabase/admin'

const MAX_LIMIT = 100
const DEFAULT_LIMIT = 50

export async function GET(req: NextRequest) {
  const auth = await authenticateApiKey(req)
  if (!auth.ok) {
    const { status, body } = apiAuthErrorResponse(auth.error)
    return NextResponse.json(body, { status })
  }

  const url = new URL(req.url)
  const statusFilter = url.searchParams.get('status')
  const limitRaw = url.searchParams.get('limit')
  const cursor = url.searchParams.get('cursor')

  const limit = Math.min(
    MAX_LIMIT,
    Math.max(1, Number.parseInt(limitRaw ?? '', 10) || DEFAULT_LIMIT),
  )

  const admin = createAdminClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let query: any = admin
    .from('blog_posts')
    .select('id, title, slug, status, post_type, wordpress_post_id, wordpress_url, published_at, created_at')
    .eq('user_id', auth.caller.userId)
    .order('created_at', { ascending: false })
    .limit(limit)

  if (statusFilter && ['published', 'draft', 'failed', 'pending'].includes(statusFilter)) {
    query = query.eq('status', statusFilter)
  }
  if (cursor) {
    query = query.lt('created_at', cursor)
  }

  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rows = (data ?? []) as Array<{ created_at: string }>
  const nextCursor = rows.length === limit ? rows[rows.length - 1].created_at : null

  return NextResponse.json({ data: rows, nextCursor })
}
