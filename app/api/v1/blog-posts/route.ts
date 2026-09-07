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
  // link_style is derived from the published content by a trigger (migration
  // 317), so it answers what a post actually contains rather than what the
  // generator meant to do. Returned here so "why is this post on geni.us" never
  // again needs a code hunt across nine generator routes.
  //
  // NAMED IN A LIST, SO IT IS ATTEMPTED AND NOT ASSUMED. PostgREST rejects the
  // ENTIRE read when one named column does not exist, which is how naming
  // blog_social_link_mode before migration 274 had run made every creator's
  // link style resolve to 'direct' with nothing on screen to show it. A column
  // that ships in an unapplied migration must cost that column and nothing
  // else, so the query drops it and runs again rather than failing the endpoint.
  const BASE_COLS = 'id, title, slug, status, post_type, wordpress_post_id, wordpress_url, published_at, created_at'
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const build = (cols: string): any => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let q: any = admin
      .from('blog_posts')
      .select(cols)
      .eq('user_id', auth.caller.userId)
      .order('created_at', { ascending: false })
      .limit(limit)
    if (statusFilter && ['published', 'draft', 'failed', 'pending'].includes(statusFilter)) {
      q = q.eq('status', statusFilter)
    }
    if (cursor) q = q.lt('created_at', cursor)
    return q
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let { data, error } = await build(`${BASE_COLS}, link_style`)
  if (error) {
    console.warn('[v1/blog-posts] retrying without link_style:', error.message)
    ;({ data, error } = await build(BASE_COLS))
  }
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rows = (data ?? []) as Array<{ created_at: string }>
  const nextCursor = rows.length === limit ? rows[rows.length - 1].created_at : null

  return NextResponse.json({ data: rows, nextCursor })
}
